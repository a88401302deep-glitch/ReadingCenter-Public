import type { StoredRemoteEntity } from '../../server/entity-api'
import type { SyncEntityKind, SyncOutboxEntry } from '../../data'

export interface RemoteApiErrorBody {
  code: string
  message: string
  current?: StoredRemoteEntity | null
}

export class RemoteApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly current?: StoredRemoteEntity | null
  ) {
    super(message)
    this.name = 'RemoteApiError'
  }
}

export class RemoteNetworkError extends Error {
  constructor(readonly cause: unknown) {
    super('Unable to reach the remote data service')
    this.name = 'RemoteNetworkError'
  }
}

export class RemoteProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteProtocolError'
  }
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class CloudflareEntityClient {
  private readonly baseUrl: string

  constructor(baseUrl = '', private readonly fetcher: Fetcher = fetch, private readonly signal?: AbortSignal) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
  }

  async list(kind: SyncEntityKind, includeDeleted = false): Promise<StoredRemoteEntity[]> {
    const suffix = includeDeleted ? '?includeDeleted=true' : ''
    const data = await this.request(`/api/v1/entities/${kind}${suffix}`)
    if (!Array.isArray(data) || !data.every(isStoredRemoteEntity)) {
      throw new RemoteProtocolError('Remote entity list has an invalid format')
    }
    return data
  }

  async get(kind: SyncEntityKind, id: string, includeDeleted = false): Promise<StoredRemoteEntity> {
    const suffix = includeDeleted ? '?includeDeleted=true' : ''
    const data = await this.request(`/api/v1/entities/${kind}/${encodeURIComponent(id)}${suffix}`)
    if (!isStoredRemoteEntity(data)) throw new RemoteProtocolError('Remote entity has an invalid format')
    return data
  }

  async apply(entry: SyncOutboxEntry): Promise<StoredRemoteEntity> {
    const path = `/api/v1/entities/${entry.kind}/${encodeURIComponent(entry.entityId)}`
    const body = entry.operation === 'put'
      ? { mutationId: entry.mutationId, baseRevision: entry.baseRevision, entity: entry.entity }
      : { mutationId: entry.mutationId, baseRevision: entry.baseRevision, deletedAt: entry.deletedAt }
    const data = await this.request(path, { method: entry.operation === 'put' ? 'PUT' : 'DELETE', body: JSON.stringify(body) })
    if (!isStoredRemoteEntity(data)) throw new RemoteProtocolError('Remote mutation result has an invalid format')
    return data
  }

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    let response: Response
    try {
      // Native browser fetch requires the global receiver, not this client instance.
      response = await this.fetcher.call(globalThis, `${this.baseUrl}${path}`, {
        ...init,
        signal: this.signal,
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers
        }
      })
    } catch (error) {
      throw new RemoteNetworkError(error)
    }

    if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('readingcenter-auth-required'))
    const body = await readJson(response)
    if (!response.ok) {
      const error = readApiError(body)
      throw new RemoteApiError(response.status, error.code, error.message, error.current)
    }
    if (!isRecord(body) || !('data' in body)) throw new RemoteProtocolError('Remote response does not contain data')
    return body.data
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new RemoteProtocolError(`Remote service returned invalid JSON (${response.status})`)
  }
}

function readApiError(body: unknown): RemoteApiErrorBody {
  if (!isRecord(body) || !isRecord(body.error) || typeof body.error.code !== 'string' || typeof body.error.message !== 'string') {
    throw new RemoteProtocolError('Remote service returned an invalid error')
  }
  return {
    code: body.error.code,
    message: body.error.message,
    current: isStoredRemoteEntity(body.error.current) || body.error.current === null ? body.error.current : undefined
  }
}

function isStoredRemoteEntity(value: unknown): value is StoredRemoteEntity {
  return isRecord(value)
    && typeof value.kind === 'string'
    && typeof value.id === 'string'
    && Number.isInteger(value.revision)
    && typeof value.createdAt === 'string'
    && typeof value.updatedAt === 'string'
    && (value.deletedAt === null || typeof value.deletedAt === 'string')
    && (value.payload === null || isRecord(value.payload))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
