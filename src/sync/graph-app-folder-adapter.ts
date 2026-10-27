import type {
  RemoteChange,
  RemoteChangePage,
  RemoteObject,
  RemoteWrite,
  RemoteWriteResult,
  SyncStoreAdapter
} from './contracts'

export interface AccessTokenProvider {
  getAccessToken(scopes: readonly string[]): Promise<string>
}

export interface GraphAppFolderAdapterOptions {
  tokenProvider: AccessTokenProvider
  fetch?: typeof globalThis.fetch
  graphBaseUrl?: string
  scopes?: readonly string[]
}

export class GraphAdapterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: 'authentication' | 'authorization' | 'conflict' | 'throttled' | 'server' | 'unexpected',
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number
  ) {
    super(message)
    this.name = 'GraphAdapterError'
  }
}

interface GraphDriveItem {
  name: string
  eTag?: string
  deleted?: object
  parentReference?: { path?: string }
}

interface GraphDeltaPage {
  value?: GraphDriveItem[]
  '@odata.nextLink'?: string
  '@odata.deltaLink'?: string
}

const defaultScopes = ['Files.ReadWrite.AppFolder'] as const
const allowedRoots = new Set(['data', 'assets', 'sync'])

export class GraphAppFolderAdapter implements SyncStoreAdapter {
  private readonly request: typeof globalThis.fetch
  private readonly baseUrl: string
  private readonly scopes: readonly string[]
  private readonly completedOperations = new Map<string, RemoteWriteResult>()

  constructor(private readonly options: GraphAppFolderAdapterOptions) {
    this.request = options.fetch ?? globalThis.fetch
    this.baseUrl = (options.graphBaseUrl ?? 'https://graph.microsoft.com/v1.0').replace(/\/$/, '')
    this.scopes = options.scopes ?? defaultScopes
  }

  async read(path: string): Promise<RemoteObject | undefined> {
    const safePath = normalizeManagedPath(path)
    const response = await this.authorizedFetch(this.contentUrl(safePath))
    if (response.status === 404) return undefined
    await assertGraphResponse(response)
    return {
      path: safePath,
      content: await response.text(),
      version: response.headers.get('etag') ?? ''
    }
  }

  async apply(writes: readonly RemoteWrite[]): Promise<RemoteWriteResult[]> {
    const results: RemoteWriteResult[] = []
    for (const write of writes) {
      const completed = this.completedOperations.get(write.operationId)
      if (completed) {
        if (completed.path !== normalizeManagedPath(write.path)) {
          throw new Error('operationId cannot be reused for a different path')
        }
        results.push(completed)
        continue
      }

      const path = normalizeManagedPath(write.path)
      const headers: Record<string, string> = { 'client-request-id': write.operationId }
      if (write.expectedVersion) headers['If-Match'] = write.expectedVersion
      if (write.kind === 'put') headers['Content-Type'] = 'application/json; charset=utf-8'

      const response = await this.authorizedFetch(
        write.kind === 'put' ? this.contentUrl(path) : this.itemUrl(path),
        {
          method: write.kind === 'put' ? 'PUT' : 'DELETE',
          headers,
          body: write.kind === 'put' ? write.content : undefined
        }
      )
      await assertGraphResponse(response)
      const result = {
        operationId: write.operationId,
        path,
        version: response.headers.get('etag') ?? write.expectedVersion ?? ''
      }
      this.completedOperations.set(write.operationId, result)
      results.push(result)
    }
    return results
  }

  async listChanges(checkpoint?: string): Promise<RemoteChangePage> {
    let nextUrl = checkpoint ? this.validateCheckpoint(checkpoint) : `${this.baseUrl}/me/drive/special/approot/delta`
    const changes: RemoteChange[] = []
    let finalCheckpoint = ''

    while (nextUrl) {
      const response = await this.authorizedFetch(nextUrl)
      await assertGraphResponse(response)
      const page = await safeJson<GraphDeltaPage>(response)
      for (const item of page.value ?? []) {
        const path = graphItemPath(item)
        if (!path || !isManagedPath(path)) continue
        changes.push({
          path,
          deleted: Boolean(item.deleted),
          version: item.eTag ?? ''
        })
      }
      if (page['@odata.nextLink']) {
        nextUrl = this.validateCheckpoint(page['@odata.nextLink'])
      } else {
        finalCheckpoint = page['@odata.deltaLink']
          ? this.validateCheckpoint(page['@odata.deltaLink'])
          : nextUrl
        nextUrl = ''
      }
    }

    return { changes, nextCheckpoint: finalCheckpoint }
  }

  private async authorizedFetch(input: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.options.tokenProvider.getAccessToken(this.scopes)
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return this.request(input, { ...init, headers })
  }

  private contentUrl(path: string): string {
    return `${this.baseUrl}/me/drive/special/approot:/${encodePath(path)}:/content`
  }

  private itemUrl(path: string): string {
    return `${this.baseUrl}/me/drive/special/approot:/${encodePath(path)}`
  }

  private validateCheckpoint(value: string): string {
    const checkpoint = new URL(value, this.baseUrl)
    const base = new URL(this.baseUrl)
    if (checkpoint.origin !== base.origin || !checkpoint.pathname.startsWith(`${base.pathname}/me/drive/`)) {
      throw new Error('Graph checkpoint must stay inside the configured Microsoft Graph drive endpoint')
    }
    return checkpoint.toString()
  }
}

export function normalizeManagedPath(path: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || /^[a-z][a-z\d+.-]*:/i.test(path)) {
    throw new Error('OneDrive path must be a relative ReadingCenter path')
  }
  const segments = path.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('OneDrive path contains an unsafe segment')
  }
  if (segments[0] !== 'manifest.json' && !allowedRoots.has(segments[0])) {
    throw new Error('OneDrive path is outside the ReadingCenter managed area')
  }
  if (segments[0] === 'manifest.json' && segments.length !== 1) {
    throw new Error('manifest.json must be a root file')
  }
  return segments.join('/')
}

function isManagedPath(path: string): boolean {
  try {
    normalizeManagedPath(path)
    return true
  } catch {
    return false
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

function graphItemPath(item: GraphDriveItem): string | null {
  if (!item.name) return null
  const parent = item.parentReference?.path
  if (!parent) return normalizeManagedPath(item.name)
  const marker = '/ReadingCenter'
  const markerIndex = parent.lastIndexOf(marker)
  const relativeParent = markerIndex >= 0
    ? parent.slice(markerIndex + marker.length).replace(/^\//, '')
    : ''
  return [relativeParent, item.name].filter(Boolean).join('/')
}

async function assertGraphResponse(response: Response): Promise<void> {
  if (response.ok) return
  if (response.status === 404) throw new GraphAdapterError('OneDrive item was not found', 404, 'unexpected', false)

  const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
  if (response.status === 401) throw new GraphAdapterError('Microsoft sign-in is required', 401, 'authentication', false)
  if (response.status === 403) throw new GraphAdapterError('OneDrive permission was denied', 403, 'authorization', false)
  if (response.status === 409 || response.status === 412) {
    throw new GraphAdapterError('OneDrive item changed on another device', response.status, 'conflict', false)
  }
  if (response.status === 429) {
    throw new GraphAdapterError('Microsoft Graph throttled the request', 429, 'throttled', true, retryAfter)
  }
  if (response.status >= 500) {
    throw new GraphAdapterError('Microsoft Graph is temporarily unavailable', response.status, 'server', true, retryAfter)
  }
  throw new GraphAdapterError('Microsoft Graph request failed', response.status, 'unexpected', false)
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

async function safeJson<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    throw new GraphAdapterError('Microsoft Graph returned invalid JSON', response.status, 'unexpected', false)
  }
}
