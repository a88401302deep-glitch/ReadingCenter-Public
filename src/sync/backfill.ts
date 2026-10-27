import type { ActivityLog, EntityMetadata, Work } from '../domain'
import type { StoredRemoteEntity } from '../server/entity-api'
import { createPutOutboxEntry, type SyncOutboxPutEntry, type SyncOutboxWriter } from '../data'

export type NextGenerationBackfillKind = 'work' | 'activityLog'
export type NextGenerationBackfillEntity = Work | ActivityLog
export type BackfillConflictReason = 'remote_deleted' | 'content_mismatch'

export interface BackfillCreateDecision {
  status: 'create'
  kind: NextGenerationBackfillKind
  id: string
  local: NextGenerationBackfillEntity
  entity: NextGenerationBackfillEntity
}

export interface BackfillSkipDecision {
  status: 'skip'
  kind: NextGenerationBackfillKind
  id: string
  local: NextGenerationBackfillEntity
  remote: StoredRemoteEntity
}

export interface BackfillConflictDecision {
  status: 'conflict'
  kind: NextGenerationBackfillKind
  id: string
  reason: BackfillConflictReason
  local: NextGenerationBackfillEntity
  remote: StoredRemoteEntity
}

export type BackfillDecision =
  | BackfillCreateDecision
  | BackfillSkipDecision
  | BackfillConflictDecision

export interface NextGenerationBackfillPreview {
  decisions: BackfillDecision[]
  summary: {
    total: number
    create: number
    skip: number
    conflict: number
  }
}

export interface NextGenerationBackfillInput {
  localWorks: Work[]
  localActivityLogs: ActivityLog[]
  remoteWorks: StoredRemoteEntity[]
  remoteActivityLogs: StoredRemoteEntity[]
}

/**
 * Produces a deterministic, read-only migration preview. It never mutates a
 * local repository, the sync outbox, or D1.
 */
export function planNextGenerationBackfill(
  input: NextGenerationBackfillInput
): NextGenerationBackfillPreview {
  const decisions = [
    ...planKind('work', input.localWorks, input.remoteWorks),
    ...planKind('activityLog', input.localActivityLogs, input.remoteActivityLogs)
  ].sort((left, right) => {
    const kindOrder = left.kind.localeCompare(right.kind)
    return kindOrder || left.id.localeCompare(right.id)
  })

  return {
    decisions,
    summary: {
      total: decisions.length,
      create: decisions.filter((decision) => decision.status === 'create').length,
      skip: decisions.filter((decision) => decision.status === 'skip').length,
      conflict: decisions.filter((decision) => decision.status === 'conflict').length
    }
  }
}

function planKind<T extends NextGenerationBackfillEntity>(
  kind: NextGenerationBackfillKind,
  localEntities: T[],
  remoteEntities: StoredRemoteEntity[]
): BackfillDecision[] {
  const localById = uniqueById(localEntities, `local ${kind}`)
  const remoteById = uniqueRemoteById(remoteEntities, kind)

  return [...localById.values()].map((local): BackfillDecision => {
    const remote = remoteById.get(local.id)
    if (!remote) {
      return {
        status: 'create',
        kind,
        id: local.id,
        local,
        entity: normalizeNewRemoteEntity(local)
      }
    }

    if (remote.deletedAt !== null || remote.payload === null) {
      return {
        status: 'conflict',
        kind,
        id: local.id,
        reason: 'remote_deleted',
        local,
        remote
      }
    }

    if (hasEquivalentContent(local, remote.payload)) {
      return { status: 'skip', kind, id: local.id, local, remote }
    }

    return {
      status: 'conflict',
      kind,
      id: local.id,
      reason: 'content_mismatch',
      local,
      remote
    }
  })
}

function uniqueById<T extends EntityMetadata>(entities: T[], label: string): Map<string, T> {
  const result = new Map<string, T>()
  for (const entity of entities) {
    if (result.has(entity.id)) throw new Error(`Duplicate ${label} id: ${entity.id}`)
    result.set(entity.id, entity)
  }
  return result
}

function uniqueRemoteById(
  entities: StoredRemoteEntity[],
  expectedKind: NextGenerationBackfillKind
): Map<string, StoredRemoteEntity> {
  const result = new Map<string, StoredRemoteEntity>()
  for (const entity of entities) {
    if (entity.kind !== expectedKind) {
      throw new Error(`Expected remote ${expectedKind}, received ${entity.kind}`)
    }
    if (result.has(entity.id)) throw new Error(`Duplicate remote ${expectedKind} id: ${entity.id}`)
    result.set(entity.id, entity)
  }
  return result
}

function normalizeNewRemoteEntity<T extends NextGenerationBackfillEntity>(entity: T): T {
  return { ...entity, revision: 1 }
}

function hasEquivalentContent(local: NextGenerationBackfillEntity, remote: Record<string, unknown>): boolean {
  return stableSerialize(withoutSyncMetadata(local)) === stableSerialize(withoutSyncMetadata(remote))
}

function withoutSyncMetadata(entity: object): Record<string, unknown> {
  const content = { ...(entity as Record<string, unknown>) }
  delete content.revision
  delete content.createdAt
  delete content.updatedAt
  return content
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

export interface BackfillSelection {
  kind: NextGenerationBackfillKind
  id: string
}

export interface StageApprovedBackfillOptions {
  writer: SyncOutboxWriter
  createMutationId: () => string
  now: () => string
}

/**
 * Stages only explicitly selected create decisions. Validation completes before
 * the writer is called, so invalid approval sets cannot partially enter the
 * durable outbox.
 */
export async function stageApprovedBackfill(
  preview: NextGenerationBackfillPreview,
  selections: BackfillSelection[],
  options: StageApprovedBackfillOptions
): Promise<SyncOutboxPutEntry[]> {
  const decisionByKey = new Map(
    preview.decisions.map((decision) => [selectionKey(decision), decision] as const)
  )
  const selectedKeys = new Set<string>()
  const selectedCreates: BackfillCreateDecision[] = []

  for (const selection of selections) {
    const key = selectionKey(selection)
    if (selectedKeys.has(key)) throw new Error(`Duplicate backfill selection: ${selection.kind} ${selection.id}`)
    selectedKeys.add(key)

    const decision = decisionByKey.get(key)
    if (!decision) throw new Error(`Unknown backfill selection: ${selection.kind} ${selection.id}`)
    if (decision.status !== 'create') {
      throw new Error(`Backfill selection is not creatable: ${selection.kind} ${selection.id} (${decision.status})`)
    }
    selectedCreates.push(decision)
  }

  const queuedAt = options.now()
  const entries = selectedCreates.map((decision) =>
    createPutOutboxEntry(decision.kind, decision.entity, options.createMutationId(), queuedAt)
  )
  const mutationIds = new Set<string>()
  for (const entry of entries) {
    if (mutationIds.has(entry.mutationId)) {
      throw new Error(`Duplicate backfill mutation id: ${entry.mutationId}`)
    }
    mutationIds.add(entry.mutationId)
  }

  await options.writer.addMany(entries)
  return entries
}

function selectionKey(selection: BackfillSelection): string {
  return JSON.stringify([selection.kind, selection.id])
}
