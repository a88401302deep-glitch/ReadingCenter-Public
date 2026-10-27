import { assertValidSourceReadingDay, type SourceReadingDay } from '../domain/source-reading-day'
import { assertValidReadingPreferences, type ReadingPreferences } from '../domain/reading-preferences'
import { assertValidReadingGoal, type ReadingGoal } from '../domain/reading-goal'

export const remoteEntityKinds = [
  'work',
  'activityLog',
  'book',
  'readingCycle',
  'readingRecord',
  'readingContent',
  'dictionary',
  'collection',
  'readingGoal',
  'readingPreferences',
  'sourceReadingDay'
] as const

export type RemoteEntityKind = (typeof remoteEntityKinds)[number]

export interface RemoteEntity {
  id: string
  createdAt: string
  updatedAt: string
  revision: number
  schemaVersion: number
  provenance: { kind: 'manual' } | { kind: 'import'; sourceId: string; externalId: string; importedAt: string }
  [key: string]: unknown
}

export interface StoredRemoteEntity {
  kind: RemoteEntityKind
  id: string
  revision: number
  createdAt: string
  updatedAt: string
  schemaVersion: number
  provenance: RemoteEntity['provenance']
  deletedAt: string | null
  payload: RemoteEntity | null
}

export interface RemoteMutationResult {
  entity: StoredRemoteEntity
  replayed: boolean
  created: boolean
}

export interface RemoteEntityStore {
  get(kind: RemoteEntityKind, id: string): Promise<StoredRemoteEntity | undefined>
  list(kind: RemoteEntityKind, includeDeleted: boolean): Promise<StoredRemoteEntity[]>
  put(input: { kind: RemoteEntityKind; mutationId: string; baseRevision: number; entity: RemoteEntity }): Promise<RemoteMutationResult>
  delete(input: { kind: RemoteEntityKind; id: string; mutationId: string; baseRevision: number; deletedAt: string }): Promise<RemoteMutationResult>
}

export class StoreConflictError extends Error {
  constructor(readonly current?: StoredRemoteEntity) {
    super('Entity revision conflict')
    this.name = 'StoreConflictError'
  }
}

export class ManualDataProtectedError extends Error {
  constructor(readonly current: StoredRemoteEntity) {
    super('Imported data cannot overwrite a manually maintained entity')
    this.name = 'ManualDataProtectedError'
  }
}

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export async function handleEntityApi(request: Request, store: RemoteEntityStore): Promise<Response> {
  try {
    const url = new URL(request.url)
    const route = parseRoute(url.pathname)
    if (!route) throw new ApiError(404, 'API route not found')

    if (request.method === 'GET') {
      if (route.id) {
        const entity = await store.get(route.kind, route.id)
        const includeDeleted = url.searchParams.get('includeDeleted') === 'true'
        if (!entity || (entity.deletedAt && !includeDeleted)) throw new ApiError(404, 'Entity not found')
        return json({ data: entity })
      }
      const includeDeleted = url.searchParams.get('includeDeleted') === 'true'
      return json({ data: await store.list(route.kind, includeDeleted) })
    }

    if (request.method === 'PUT' && route.id) {
      const body = await parseBody(request)
      const mutationId = readMutationId(body)
      const baseRevision = readBaseRevision(body)
      const entity = body.entity
      assertEntity(route.kind, route.id, entity, baseRevision)
      const result = await store.put({ kind: route.kind, mutationId, baseRevision, entity })
      return json({ data: result.entity, replayed: result.replayed }, result.created ? 201 : 200)
    }

    if (request.method === 'DELETE' && route.id) {
      const body = await parseBody(request)
      const result = await store.delete({
        kind: route.kind,
        id: route.id,
        mutationId: readMutationId(body),
        baseRevision: readBaseRevision(body),
        deletedAt: readIsoDateTime(body.deletedAt, 'deletedAt')
      })
      return json({ data: result.entity, replayed: result.replayed })
    }

    throw new ApiError(405, 'Method not allowed')
  } catch (error) {
    if (error instanceof StoreConflictError) {
      return json({ error: { code: 'revision_conflict', message: error.message, current: error.current ?? null } }, 409)
    }
    if (error instanceof ManualDataProtectedError) {
      return json({ error: { code: 'manual_data_protected', message: error.message, current: error.current } }, 409)
    }
    if (error instanceof ApiError) {
      return json({ error: { code: error.status === 404 ? 'not_found' : 'invalid_request', message: error.message } }, error.status)
    }
    if (isStorageLimitError(error)) {
      return json({ error: { code: 'storage_limit_reached', message: 'Cloud storage limit reached; no data was changed' } }, 507)
    }
    return json({ error: { code: 'internal_error', message: 'Unable to process the request' } }, 500)
  }
}

function parseRoute(pathname: string): { kind: RemoteEntityKind; id?: string } | undefined {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length < 4 || parts.length > 5 || parts[0] !== 'api' || parts[1] !== 'v1' || parts[2] !== 'entities') return undefined
  const kind = parts[3]
  if (!remoteEntityKinds.includes(kind as RemoteEntityKind)) return undefined
  const id = parts[4] ? decodeURIComponent(parts[4]) : undefined
  if (id !== undefined && !id.trim()) return undefined
  return { kind: kind as RemoteEntityKind, id }
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown
  try {
    value = await request.json()
  } catch {
    throw new ApiError(400, 'Request body must be valid JSON')
  }
  if (!isRecord(value)) throw new ApiError(400, 'Request body must be an object')
  return value
}

function readMutationId(body: Record<string, unknown>): string {
  if (typeof body.mutationId !== 'string' || !/^[A-Za-z0-9._:-]{8,128}$/.test(body.mutationId)) {
    throw new ApiError(400, 'mutationId must contain 8-128 safe characters')
  }
  return body.mutationId
}

function readBaseRevision(body: Record<string, unknown>): number {
  if (!Number.isInteger(body.baseRevision) || Number(body.baseRevision) < 0) {
    throw new ApiError(400, 'baseRevision must be a non-negative integer')
  }
  return Number(body.baseRevision)
}

function assertEntity(kind: RemoteEntityKind, id: string, value: unknown, baseRevision: number): asserts value is RemoteEntity {
  if (!isRecord(value)) throw new ApiError(400, 'entity must be an object')
  if (value.id !== id) throw new ApiError(400, 'Entity id must match the route id')
  readIsoDateTime(value.createdAt, 'entity.createdAt')
  readIsoDateTime(value.updatedAt, 'entity.updatedAt')
  if (!Number.isInteger(value.revision) || Number(value.revision) !== baseRevision + 1) {
    throw new ApiError(400, 'entity.revision must equal baseRevision + 1')
  }
  if (!Number.isInteger(value.schemaVersion) || Number(value.schemaVersion) < 1) {
    throw new ApiError(400, 'entity.schemaVersion must be a positive integer')
  }
  assertProvenance(value.provenance)
  if (kind === 'work') {
    requireText(value.title, 'Work title')
    requireText(value.mediaType, 'Work mediaType')
  } else if (kind === 'activityLog') {
    requireText(value.workId, 'ActivityLog workId')
    if (!['read', 'watch'].includes(String(value.activityType))) {
      throw new ApiError(400, 'ActivityLog activityType is invalid')
    }
    const startedAt = readIsoDateTime(value.startedAt, 'ActivityLog startedAt')
    const endedAt = value.endedAt === null ? null : readIsoDateTime(value.endedAt, 'ActivityLog endedAt')
    if (endedAt !== null && endedAt < startedAt) {
      throw new ApiError(400, 'ActivityLog endedAt must not precede startedAt')
    }
    if (
      value.durationMinutes !== null &&
      (!Number.isInteger(value.durationMinutes) || Number(value.durationMinutes) < 0)
    ) {
      throw new ApiError(400, 'ActivityLog durationMinutes must be a non-negative integer or null')
    }
  } else if (kind === 'sourceReadingDay') {
    try { assertValidSourceReadingDay(value as unknown as SourceReadingDay) } catch { throw new ApiError(400, 'Source reading day is invalid') }
  } else if (kind === 'readingPreferences') {
    try { assertValidReadingPreferences(value as unknown as ReadingPreferences) } catch { throw new ApiError(400, 'Reading preferences are invalid') }
  } else if (kind === 'readingGoal') {
    try { assertValidReadingGoal(value as unknown as ReadingGoal) } catch { throw new ApiError(400, 'Reading goal is invalid') }
  } else if (kind === 'book') {
    requireText(value.title, 'Book title')
    requireText(value.mediaTypeId, 'Book mediaTypeId')
  } else if (kind === 'readingCycle') {
    requireText(value.bookId, 'ReadingCycle bookId')
    if (!Number.isInteger(value.sequence) || Number(value.sequence) < 1) throw new ApiError(400, 'ReadingCycle sequence is invalid')
  } else if (kind === 'readingRecord') {
    requireText(value.bookId, 'ReadingRecord bookId')
    readIsoDateTime(value.startedAt, 'ReadingRecord startedAt')
  } else if (kind === 'readingContent') {
    requireText(value.bookId, 'ReadingContent bookId')
    requireText(value.text, 'ReadingContent text')
    if (!['highlight', 'shortReview', 'longReview'].includes(String(value.type))) throw new ApiError(400, 'ReadingContent type is invalid')
  } else if (kind === 'dictionary') {
    requireText(value.name, 'Dictionary name')
  } else {
    requireText(value.name, 'Collection name')
    if (!['series', 'periodical'].includes(String(value.kind))) throw new ApiError(400, 'Collection kind is invalid')
  }
}

function assertProvenance(value: unknown): asserts value is RemoteEntity['provenance'] {
  if (!isRecord(value) || !['manual', 'import'].includes(String(value.kind))) throw new ApiError(400, 'entity.provenance is invalid')
  if (value.kind === 'import') {
    requireText(value.sourceId, 'provenance.sourceId')
    requireText(value.externalId, 'provenance.externalId')
    readIsoDateTime(value.importedAt, 'provenance.importedAt')
  }
}

function readIsoDateTime(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) {
    throw new ApiError(400, `${field} must be an ISO 8601 UTC datetime`)
  }
  return value
}

function requireText(value: unknown, field: string): void {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, `${field} must not be empty`)
}

function isStorageLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /(?:quota|storage|limit).*(?:exceed|reach)|(?:exceed|reach).*(?:quota|storage|limit)/i.test(error.message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } })
}

