import { assertIsoDateTime } from '../domain'
import type { ReadingCenterRepositories } from '../data/repository'
import {
  oneDriveFormatVersion,
  type ConflictResolution,
  type OneDriveSnapshot,
  type SyncEntityKind,
  type SyncEnvelope
} from './contracts'

const entityKinds: readonly SyncEntityKind[] = ['book', 'readingCycle', 'readingRecord', 'readingContent']

export function validateSnapshot(value: unknown): asserts value is OneDriveSnapshot {
  if (!value || typeof value !== 'object') throw new Error('OneDrive snapshot must be an object')
  const snapshot = value as Partial<OneDriveSnapshot>
  if (!snapshot.manifest || snapshot.manifest.formatVersion !== oneDriveFormatVersion) {
    throw new Error('Unsupported OneDrive snapshot format version')
  }
  if (!Number.isInteger(snapshot.manifest.schemaVersion) || snapshot.manifest.schemaVersion < 1) {
    throw new Error('OneDrive manifest schemaVersion must be a positive integer')
  }
  if (!snapshot.manifest.snapshotId?.trim()) throw new Error('OneDrive manifest snapshotId is required')
  assertIsoDateTime(snapshot.manifest.generatedAt, 'OneDrive manifest generatedAt')
  if (!snapshot.entities || typeof snapshot.entities !== 'object') {
    throw new Error('OneDrive snapshot entities are required')
  }

  for (const kind of entityKinds) {
    if (!snapshot.manifest.entityFiles?.[kind]?.trim()) {
      throw new Error(`OneDrive manifest is missing the ${kind} file`)
    }
    const envelopes = snapshot.entities[kind]
    if (!Array.isArray(envelopes)) throw new Error(`OneDrive snapshot ${kind} must be an array`)
    for (const envelope of envelopes) validateEnvelope(envelope, kind)
  }
}

function validateEnvelope(value: unknown, expectedKind: SyncEntityKind): void {
  if (!value || typeof value !== 'object') throw new Error('Sync envelope must be an object')
  const envelope = value as Partial<SyncEnvelope>
  if (envelope.formatVersion !== oneDriveFormatVersion || envelope.kind !== expectedKind) {
    throw new Error(`Invalid ${expectedKind} envelope format or kind`)
  }
  if (!envelope.id?.trim()) throw new Error('Sync envelope id is required')
  if (!Number.isInteger(envelope.revision) || Number(envelope.revision) < 1) {
    throw new Error('Sync envelope revision must be a positive integer')
  }
  if (!envelope.updatedAt) throw new Error('Sync envelope updatedAt is required')
  assertIsoDateTime(envelope.updatedAt, 'Sync envelope updatedAt')
  if (!envelope.provenance || !['manual', 'import'].includes(envelope.provenance.kind)) {
    throw new Error('Sync envelope provenance is invalid')
  }
  if (envelope.deleted === true && envelope.payload !== null) {
    throw new Error('Tombstone payload must be null')
  }
  if (envelope.deleted === false) {
    if (!envelope.payload || envelope.payload.id !== envelope.id) {
      throw new Error('Live envelope payload must have the same id')
    }
    if (envelope.payload.revision !== envelope.revision || envelope.payload.updatedAt !== envelope.updatedAt) {
      throw new Error('Envelope metadata must match payload metadata')
    }
  }
  if (typeof envelope.deleted !== 'boolean') throw new Error('Sync envelope deleted flag is required')
}

export function serializeSnapshot(snapshot: OneDriveSnapshot): string {
  validateSnapshot(snapshot)
  return JSON.stringify(snapshot, null, 2) + '\n'
}

export function parseSnapshot(content: string): OneDriveSnapshot {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error('OneDrive snapshot is not valid JSON')
  }
  validateSnapshot(value)
  return value
}

export function resolveConflict<K extends SyncEntityKind>(
  local: SyncEnvelope<K>,
  remote: SyncEnvelope<K>
): ConflictResolution<K> {
  if (local.kind !== remote.kind || local.id !== remote.id) {
    throw new Error('Only matching sync entities can be resolved')
  }
  if (JSON.stringify(local) === JSON.stringify(remote)) {
    return { status: 'resolved', winner: local, reason: 'same' }
  }
  if (local.provenance.kind !== remote.provenance.kind) {
    return {
      status: 'resolved',
      winner: local.provenance.kind === 'manual' ? local : remote,
      reason: 'manual-priority'
    }
  }
  if (local.revision !== remote.revision) {
    return {
      status: 'resolved',
      winner: local.revision > remote.revision ? local : remote,
      reason: 'revision'
    }
  }
  if (local.updatedAt !== remote.updatedAt) {
    return {
      status: 'resolved',
      winner: local.updatedAt > remote.updatedAt ? local : remote,
      reason: 'updatedAt'
    }
  }
  if (local.deleted !== remote.deleted) {
    return {
      status: 'resolved',
      winner: local.deleted ? local : remote,
      reason: 'tombstone'
    }
  }
  return { status: 'conflict', local, remote, reason: 'concurrent-manual' }
}

export async function rebuildCoreCache(
  repositories: ReadingCenterRepositories,
  snapshot: OneDriveSnapshot
): Promise<void> {
  validateSnapshot(snapshot)

  await Promise.all([
    repositories.books.clear(),
    repositories.readingCycles.clear(),
    repositories.readingRecords.clear(),
    repositories.readingContents.clear()
  ])

  for (const envelope of snapshot.entities.book) {
    if (!envelope.deleted && envelope.payload) await repositories.books.save(envelope.payload)
  }
  for (const envelope of snapshot.entities.readingCycle) {
    if (!envelope.deleted && envelope.payload) await repositories.readingCycles.save(envelope.payload)
  }
  for (const envelope of snapshot.entities.readingRecord) {
    if (!envelope.deleted && envelope.payload) await repositories.readingRecords.save(envelope.payload)
  }
  for (const envelope of snapshot.entities.readingContent) {
    if (!envelope.deleted && envelope.payload) await repositories.readingContents.save(envelope.payload)
  }
}
