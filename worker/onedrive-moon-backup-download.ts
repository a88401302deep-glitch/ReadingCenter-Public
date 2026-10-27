import type { GraphAccessTokenProvider, MoonBackupDriveFile } from './onedrive-moon-backup-source'

const defaultMaxDownloadBytes = 256 * 1024 * 1024

export interface OneDriveMoonBackupDownloaderOptions {
  tokenProvider: GraphAccessTokenProvider
  fetch?: typeof globalThis.fetch
  graphBaseUrl?: string
  maxDownloadBytes?: number
}

/** Downloads a listed Moon+ backup without forwarding the Graph token to its pre-authenticated URL. */
export class OneDriveMoonBackupDownloader {
  private readonly request: typeof globalThis.fetch
  private readonly graphBaseUrl: string
  private readonly maxDownloadBytes: number

  constructor(private readonly options: OneDriveMoonBackupDownloaderOptions) {
    this.request = options.fetch ?? globalThis.fetch
    const configuredBase = options.graphBaseUrl ?? 'https://graph.microsoft.com/v1.0'
    this.graphBaseUrl = configuredBase.endsWith('/') ? configuredBase.slice(0, -1) : configuredBase
    this.maxDownloadBytes = options.maxDownloadBytes ?? defaultMaxDownloadBytes
    if (!Number.isSafeInteger(this.maxDownloadBytes) || this.maxDownloadBytes < 1) {
      throw new Error('Maximum backup download size must be a positive safe integer')
    }
  }

  async download(file: MoonBackupDriveFile): Promise<Uint8Array> {
    if (!file.driveItemId || !file.name.toLocaleLowerCase().endsWith('.mrpro')) {
      throw new Error('Only a listed .mrpro backup can be downloaded')
    }
    if (file.size !== null && file.size > this.maxDownloadBytes) {
      throw new Error('Moon+ backup exceeds the configured download size limit')
    }

    const token = await this.options.tokenProvider.getAccessToken(['Files.Read'])
    if (!token) throw new Error('Microsoft sign-in is required')

    const graphUrl = `${this.graphBaseUrl}/me/drive/items/${encodeURIComponent(file.driveItemId)}/content`
    const graphResponse = await this.request(graphUrl, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'manual'
    })
    if (graphResponse.status !== 302 && graphResponse.status !== 303) {
      if (!graphResponse.ok) throw graphError(graphResponse.status)
      throw new Error('Microsoft Graph returned an unexpected backup download response')
    }

    const location = graphResponse.headers.get('Location')
    if (!location) throw new Error('Microsoft Graph omitted the backup download location')
    const downloadUrl = validateDownloadUrl(location)
    const downloadResponse = await this.request(downloadUrl, { redirect: 'manual' })
    if (!downloadResponse.ok) throw new Error('OneDrive backup download failed')
    const declaredLength = Number(downloadResponse.headers.get('Content-Length'))
    if (Number.isFinite(declaredLength) && declaredLength > this.maxDownloadBytes) {
      await downloadResponse.body?.cancel()
      throw new Error('Moon+ backup exceeds the configured download size limit')
    }
    if (!downloadResponse.body) return new Uint8Array()
    return readLimitedBody(downloadResponse.body, this.maxDownloadBytes)
  }
}

function validateDownloadUrl(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('Microsoft Graph returned an invalid backup download location') }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Microsoft Graph returned an unsafe backup download location')
  }
  return url.toString()
}

async function readLimitedBody(body: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new Error('Moon+ backup exceeds the configured download size limit')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function graphError(status: number): Error {
  if (status === 401) return new Error('Microsoft sign-in is required')
  if (status === 403) return new Error('OneDrive read permission was denied')
  if (status === 429) return new Error('Microsoft Graph throttled the request')
  if (status >= 500) return new Error('Microsoft Graph is temporarily unavailable')
  return new Error(`Microsoft Graph backup download failed (${status})`)
}
