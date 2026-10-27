import { describe, expect, it, vi } from 'vitest'
import type { ActivityLog, Work } from '../../src/domain'
import type { RemoteEntity, StoredRemoteEntity } from '../../src/server/entity-api'
import { planNextGenerationBackfill, stageApprovedBackfill } from '../../src/sync'

const firstAt = '2026-09-15T00:00:00.000Z'
const secondAt = '2026-09-15T01:00:00.000Z'

describe('next-generation backfill preview', () => {
  it('classifies missing, equivalent, mismatched, and deleted entities without writing', () => {
    const missingWork = work({ id: 'work-missing', revision: 7 })
    const equivalentWork = work({ id: 'work-existing', revision: 5 })
    const changedWork = work({ id: 'work-changed', title: '本機書名' })
    const deletedActivity = activityLog({ id: 'activity-deleted' })

    const preview = planNextGenerationBackfill({
      localWorks: [changedWork, missingWork, equivalentWork],
      localActivityLogs: [deletedActivity],
      remoteWorks: [
        stored('work', equivalentWork, { ...equivalentWork, revision: 2, updatedAt: secondAt }),
        stored('work', changedWork, { ...changedWork, title: '遠端書名' })
      ],
      remoteActivityLogs: [
        { ...stored('activityLog', deletedActivity), deletedAt: secondAt, payload: null }
      ]
    })

    expect(preview.summary).toEqual({ total: 4, create: 1, skip: 1, conflict: 2 })
    expect(preview.decisions.map(({ kind, id, status }) => ({ kind, id, status }))).toEqual([
      { kind: 'activityLog', id: 'activity-deleted', status: 'conflict' },
      { kind: 'work', id: 'work-changed', status: 'conflict' },
      { kind: 'work', id: 'work-existing', status: 'skip' },
      { kind: 'work', id: 'work-missing', status: 'create' }
    ])

    const create = preview.decisions.find((decision) => decision.status === 'create')
    expect(create).toMatchObject({
      kind: 'work',
      id: 'work-missing',
      entity: {
        id: 'work-missing',
        revision: 1,
        createdAt: firstAt,
        provenance: { kind: 'manual' }
      }
    })
    expect(missingWork.revision).toBe(7)
  })

  it('is deterministic and treats metadata-only revision changes as equivalent', () => {
    const local = activityLog({ revision: 4 })
    const remote = stored('activityLog', local, {
      ...local,
      revision: 9,
      createdAt: secondAt,
      updatedAt: secondAt
    })
    const input = {
      localWorks: [],
      localActivityLogs: [local],
      remoteWorks: [],
      remoteActivityLogs: [remote]
    }

    expect(planNextGenerationBackfill(input)).toEqual(planNextGenerationBackfill(input))
    expect(planNextGenerationBackfill(input).summary.skip).toBe(1)
  })

  it('fails closed on duplicate IDs or the wrong remote kind', () => {
    const local = work()
    expect(() => planNextGenerationBackfill({
      localWorks: [local, { ...local }],
      localActivityLogs: [],
      remoteWorks: [],
      remoteActivityLogs: []
    })).toThrow('Duplicate local work id')

    expect(() => planNextGenerationBackfill({
      localWorks: [local],
      localActivityLogs: [],
      remoteWorks: [stored('book', local)],
      remoteActivityLogs: []
    })).toThrow('Expected remote work')
  })
})

function work(changes: Partial<Work> = {}): Work {
  return {
    id: 'work-1',
    createdAt: firstAt,
    updatedAt: firstAt,
    revision: 1,
    schemaVersion: 1,
    provenance: { kind: 'manual' },
    title: '測試作品',
    preferredTitle: null,
    subtitle: null,
    originalTitle: null,
    languageTag: 'zh-Hant',
    titleAliases: [],
    externalReferences: [],
    mediaType: 'novel',
    creatorIds: [],
    categoryIds: [],
    tagIds: [],
    sourceIds: [],
    cover: null,
    note: '',
    typeMetadata: {
      kind: 'publication',
      publicationKind: 'published',
      collectionId: null,
      sequence: null,
      serialization: null,
      isbn: null,
      publishedOn: null,
      publisherId: null
    },
    ...changes
  }
}

function activityLog(changes: Partial<ActivityLog> = {}): ActivityLog {
  return {
    id: 'activity-1',
    createdAt: firstAt,
    updatedAt: firstAt,
    revision: 1,
    schemaVersion: 1,
    provenance: { kind: 'manual' },
    workId: 'work-1',
    cycleId: null,
    activityType: 'read',
    startedAt: firstAt,
    endedAt: secondAt,
    durationMinutes: 60,
    progressBefore: null,
    progressAfter: { unit: 'percent', value: 20 },
    deviceId: null,
    sourceId: null,
    note: '',
    ...changes
  }
}

function stored(
  kind: StoredRemoteEntity['kind'],
  entity: Work | ActivityLog,
  payload: Work | ActivityLog = entity
): StoredRemoteEntity {
  return {
    kind,
    id: entity.id,
    revision: payload.revision,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    schemaVersion: payload.schemaVersion,
    provenance: payload.provenance,
    deletedAt: null,
    payload: payload as unknown as RemoteEntity
  }
}


describe('approved backfill staging', () => {
  it('stages only explicitly approved create decisions', async () => {
    const preview = planNextGenerationBackfill({
      localWorks: [work({ id: 'work-approved', revision: 8 })],
      localActivityLogs: [activityLog({ id: 'activity-not-selected', revision: 4 })],
      remoteWorks: [],
      remoteActivityLogs: []
    })
    const addMany = vi.fn(async () => undefined)

    const entries = await stageApprovedBackfill(
      preview,
      [{ kind: 'work', id: 'work-approved' }],
      {
        writer: { addMany },
        createMutationId: () => 'mutation-approved',
        now: () => secondAt
      }
    )

    expect(addMany).toHaveBeenCalledOnce()
    expect(entries).toEqual([
      expect.objectContaining({
        mutationId: 'mutation-approved',
        kind: 'work',
        entityId: 'work-approved',
        baseRevision: 0,
        queuedAt: secondAt,
        entity: expect.objectContaining({ revision: 1 })
      })
    ])
  })

  it('rejects unknown, duplicate, skip, and conflict selections before writing', async () => {
    const existing = work({ id: 'work-existing' })
    const conflicting = activityLog({ id: 'activity-conflict' })
    const preview = planNextGenerationBackfill({
      localWorks: [existing, work({ id: 'work-create' })],
      localActivityLogs: [conflicting],
      remoteWorks: [stored('work', existing)],
      remoteActivityLogs: [
        stored('activityLog', conflicting, { ...conflicting, durationMinutes: 5 })
      ]
    })
    const addMany = vi.fn(async () => undefined)
    const options = {
      writer: { addMany },
      createMutationId: () => 'mutation-unused',
      now: () => secondAt
    }

    await expect(stageApprovedBackfill(
      preview,
      [{ kind: 'work', id: 'missing' }],
      options
    )).rejects.toThrow('Unknown backfill selection')
    await expect(stageApprovedBackfill(
      preview,
      [{ kind: 'work', id: 'work-existing' }],
      options
    )).rejects.toThrow('(skip)')
    await expect(stageApprovedBackfill(
      preview,
      [{ kind: 'activityLog', id: 'activity-conflict' }],
      options
    )).rejects.toThrow('(conflict)')
    await expect(stageApprovedBackfill(
      preview,
      [
        { kind: 'work', id: 'work-create' },
        { kind: 'work', id: 'work-create' }
      ],
      options
    )).rejects.toThrow()
    expect(addMany).not.toHaveBeenCalled()
  })

  it('rejects duplicate generated mutation IDs before writing', async () => {
    const preview = planNextGenerationBackfill({
      localWorks: [work({ id: 'work-1' }), work({ id: 'work-2' })],
      localActivityLogs: [],
      remoteWorks: [],
      remoteActivityLogs: []
    })
    const addMany = vi.fn(async () => undefined)

    await expect(stageApprovedBackfill(
      preview,
      [
        { kind: 'work', id: 'work-1' },
        { kind: 'work', id: 'work-2' }
      ],
      {
        writer: { addMany },
        createMutationId: () => 'duplicate-mutation',
        now: () => secondAt
      }
    )).rejects.toThrow('Duplicate backfill mutation id')
    expect(addMany).not.toHaveBeenCalled()
  })
})
