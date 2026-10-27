export const moonBackupGraphScopes = ['Files.Read'] as const
export const defaultMoonBackupFolderPath = '書籍相關/閱讀紀錄'

export interface GraphAccessTokenProvider {
  getAccessToken(scopes: readonly string[]): Promise<string>
}

export interface MoonBackupDriveFile {
  driveItemId: string
  deviceFolder: string
  name: string
  eTag: string
  size: number | null
  lastModifiedDateTime: string | null
}

export interface OneDriveMoonBackupSourceOptions {
  tokenProvider: GraphAccessTokenProvider
  fetch?: typeof globalThis.fetch
  graphBaseUrl?: string
  folderPath?: string
}

interface DriveItem {
  id?: string
  name?: string
  eTag?: string
  size?: number
  lastModifiedDateTime?: string
  file?: Record<string, unknown>
  folder?: { childCount?: number }
}

interface DriveItemPage {
  value?: DriveItem[]
  '@odata.nextLink'?: string
}

const maxPagesPerFolder = 100

/**
 * Read-only listing for Moon+ backups stored in
 * 書籍相關/閱讀紀錄/<device folder>/*.mrpro.
 *
 * This intentionally lists only the immediate device folders and their
 * immediate children. It never follows arbitrary paths or writes to OneDrive.
 */
export class OneDriveMoonBackupSource {
  private readonly request: typeof globalThis.fetch
  private readonly baseUrl: string
  private readonly folderPath: string

  constructor(private readonly options: OneDriveMoonBackupSourceOptions) {
    this.request = options.fetch ?? globalThis.fetch
    this.baseUrl = (options.graphBaseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '')
    this.folderPath = normalizeFolderPath(options.folderPath ?? defaultMoonBackupFolderPath)
  }

  async listBackups(): Promise<MoonBackupDriveFile[]> {
    const deviceFolders = (await this.listChildrenByPath(this.folderPath)).filter(item => item.folder && item.id && item.name)
    const files = await Promise.all(deviceFolders.map(async folder => {
      const children = await this.listChildrenById(folder.id!)
      return children
        .filter(item => item.file && item.id && item.name && item.name.toLocaleLowerCase().endsWith('.mrpro'))
        .map(item => ({
          driveItemId: item.id!,
          deviceFolder: folder.name!,
          name: item.name!,
          eTag: item.eTag ?? '',
          size: Number.isSafeInteger(item.size) && item.size! >= 0 ? item.size! : null,
          lastModifiedDateTime: item.lastModifiedDateTime ?? null
        }))
    }))
    return files.flat().sort((a, b) =>
      a.deviceFolder.localeCompare(b.deviceFolder) || a.name.localeCompare(b.name)
    )
  }

  private listChildrenByPath(path: string): Promise<DriveItem[]> {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/')
    return this.readAllPages(`${this.baseUrl}/me/drive/root:/${encodedPath}:/children`)
  }

  private listChildrenById(id: string): Promise<DriveItem[]> {
    return this.readAllPages(`${this.baseUrl}/me/drive/items/${encodeURIComponent(id)}/children`)
  }

  private async readAllPages(firstUrl: string): Promise<DriveItem[]> {
    let nextUrl: string | undefined = firstUrl
    const items: DriveItem[] = []
    let pages = 0
    while (nextUrl) {
      if (++pages > maxPagesPerFolder) throw new Error('OneDrive folder has too many pages to scan safely')
      const response = await this.authorizedFetch(nextUrl)
      if (!response.ok) throw graphError(response.status)
      const page = await safeJson(response)
      if (!Array.isArray(page.value)) throw new Error('Microsoft Graph returned an invalid folder listing')
      items.push(...page.value.filter(isDriveItem))
      nextUrl = page['@odata.nextLink']
        ? this.validateGraphUrl(page['@odata.nextLink'])
        : undefined
    }
    return items
  }

  private async authorizedFetch(url: string): Promise<Response> {
    const token = await this.options.tokenProvider.getAccessToken(moonBackupGraphScopes)
    if (!token) throw new Error('Microsoft sign-in is required')
    return this.request(url, { headers: { Authorization: `Bearer ${token}` } })
  }

  private validateGraphUrl(value: string): string {
    let candidate: URL
    try { candidate = new URL(value) } catch { throw new Error('Microsoft Graph returned an invalid paging URL') }
    const base = new URL(this.baseUrl)
    if (candidate.origin !== base.origin || !candidate.pathname.startsWith(`${base.pathname}/me/drive/`)) {
      throw new Error('Microsoft Graph paging URL left the configured OneDrive endpoint')
    }
    return candidate.toString()
  }
}

function normalizeFolderPath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error('OneDrive backup folder must be a relative path')
  }
  const segments = path.split('/')
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('OneDrive backup folder contains an unsafe path segment')
  }
  return segments.join('/')
}

function isDriveItem(value: unknown): value is DriveItem {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function safeJson(response: Response): Promise<DriveItemPage> {
  try { return await response.json() as DriveItemPage } catch {
    throw new Error('Microsoft Graph returned invalid JSON')
  }
}

function graphError(status: number): Error {
  if (status === 401) return new Error('Microsoft sign-in is required')
  if (status === 403) return new Error('OneDrive read permission was denied')
  if (status === 429) return new Error('Microsoft Graph throttled the request')
  if (status >= 500) return new Error('Microsoft Graph is temporarily unavailable')
  return new Error(`Microsoft Graph folder scan failed (${status})`)
}
