import {
  assertValidSourceReadingDay, type SourceReadingDay,
  assertIsoDateTime, assertValidActivityLog, assertValidBook, assertValidBookCollection,
  assertValidDictionaryEntry, assertValidReadingContent, assertValidReadingCycle,
  assertValidReadingRecord, assertValidWork, assertValidReadingGoal, assertValidReadingPreferences,
  type ActivityLog, type Book, type BookCollection, type DictionaryEntry,
  type ReadingContent, type ReadingCycle, type ReadingRecord, type Work, type ReadingGoal, type ReadingPreferences
} from '../../domain'
import type { SyncEntityKind } from '../../data'
import type { StoredRemoteEntity } from '../../server/entity-api'
import { RemoteProtocolError } from './entity-client'

export const syncTables = {
  sourceReadingDay: 'sourceReadingDays',
  work: 'works', activityLog: 'activityLogs', book: 'books', readingCycle: 'readingCycles',
  readingRecord: 'readingRecords', readingContent: 'readingContents', dictionary: 'dictionaries', collection: 'collections', readingGoal: 'readingGoals', readingPreferences: 'readingPreferences'
} as const satisfies Record<SyncEntityKind, string>

export function fingerprint(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    }
    return item
  })
}

export function validateRemote(kind: SyncEntityKind, remote: StoredRemoteEntity): void {
  try {
    if (remote.kind !== kind || !remote.id.trim() || !Number.isSafeInteger(remote.revision) || remote.revision < 1
      || !Number.isSafeInteger(remote.schemaVersion) || remote.schemaVersion < 1) throw new Error('Invalid envelope')
    assertIsoDateTime(remote.createdAt, 'createdAt')
    assertIsoDateTime(remote.updatedAt, 'updatedAt')
    if (remote.deletedAt !== null) {
      assertIsoDateTime(remote.deletedAt, 'deletedAt')
      if (remote.payload !== null) throw new Error('Tombstone must have no payload')
      return
    }
    const entity = remote.payload
    if (!entity || entity.id !== remote.id || entity.revision !== remote.revision
      || entity.updatedAt !== remote.updatedAt || entity.createdAt !== remote.createdAt
      || entity.schemaVersion !== remote.schemaVersion || fingerprint(entity.provenance) !== fingerprint(remote.provenance)) {
      throw new Error('Payload metadata does not match envelope')
    }
    if (!['manual', 'import'].includes(entity.provenance.kind)) throw new Error('Invalid provenance')
    if (entity.provenance.kind === 'import') {
      if (!entity.provenance.sourceId.trim() || !entity.provenance.externalId.trim()) throw new Error('Invalid source')
      assertIsoDateTime(entity.provenance.importedAt, 'importedAt')
    }
    switch (kind) {
      case 'sourceReadingDay': assertValidSourceReadingDay(entity as unknown as SourceReadingDay); break
      case 'work': assertValidWork(entity as unknown as Work); break
      case 'activityLog': assertValidActivityLog(entity as unknown as ActivityLog); break
      case 'book': assertValidBook(entity as unknown as Book); break
      case 'readingCycle': assertValidReadingCycle(entity as unknown as ReadingCycle); break
      case 'readingRecord': assertValidReadingRecord(entity as unknown as ReadingRecord); break
      case 'readingContent': assertValidReadingContent(entity as unknown as ReadingContent); break
      case 'dictionary': assertValidDictionaryEntry(entity as unknown as DictionaryEntry); break
      case 'collection': assertValidBookCollection(entity as unknown as BookCollection); break
      case 'readingGoal': assertValidReadingGoal(entity as unknown as ReadingGoal); break
      case 'readingPreferences': assertValidReadingPreferences(entity as unknown as ReadingPreferences); break
    }
  } catch {
    throw new RemoteProtocolError('Remote entity does not match the supported data format')
  }
}

