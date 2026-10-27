import Dexie, { type Table } from 'dexie'
import {
  migrateBookToWork,
  migrateReadingRecordToActivityLog,
  type ActivityLog,
  type Book,
  type BookCollection,
  type DictionaryEntry,
  type EntityMetadata,
  type ReadingContent,
  type ReadingCycle,
  type ReadingRecord,
  type ReadingGoal,
  type ReadingPreferences,
  type SourceReadingDay,
  type Work
} from '../../domain'
import type { SyncOutboxEntry } from './sync-outbox'
import type { SyncConflictRecord } from './sync-conflict'
import type { SyncReviewArchive } from './sync-review'

export const LOCAL_DATABASE_SCHEMA_VERSION = 13
export const DEFAULT_LOCAL_DATABASE_NAME = 'reading-center-local'

const versionOneStores = {
  books: 'id, title',
  readingCycles: 'id, bookId, status',
  readingRecords: 'id, bookId, cycleId, startedAt',
  readingContents: 'id, bookId, cycleId, readingRecordId, type'
}

const versionTwoStores = {
  books: 'id, title, updatedAt',
  readingCycles: 'id, bookId, status, updatedAt',
  readingRecords: 'id, bookId, cycleId, startedAt, updatedAt',
  readingContents: 'id, bookId, cycleId, readingRecordId, type, updatedAt'
}

const versionThreeStores = {
  ...versionTwoStores,
  dictionaries: 'id, kind, name, updatedAt'
}

const versionFourStores = versionThreeStores
const versionFiveStores = { ...versionFourStores, collections: 'id, kind, name, updatedAt' }
const versionSixStores = {
  ...versionFiveStores,
  syncOutbox: '++sequence, &mutationId, [kind+entityId], queuedAt'
}
const versionSevenStores = {
  ...versionSixStores,
  syncConflicts: '&mutationId, [kind+entityId], detectedAt'
}
const versionEightStores = {
  ...versionSevenStores,
  works: 'id, title, mediaType, updatedAt',
  activityLogs: 'id, workId, cycleId, activityType, startedAt, updatedAt'
}

type StoredEntity = EntityMetadata & Record<string, unknown>

function migrateMetadata(entity: StoredEntity): StoredEntity {
  if (typeof entity.createdAt !== 'string') {
    throw new Error(`Cannot migrate entity ${String(entity.id)} without createdAt`)
  }

  return {
    ...entity,
    updatedAt: typeof entity.updatedAt === 'string' ? entity.updatedAt : entity.createdAt,
    revision: typeof entity.revision === 'number' ? entity.revision : 1,
    schemaVersion: typeof entity.schemaVersion === 'number' ? entity.schemaVersion : 1,
    provenance: entity.provenance ?? { kind: 'manual' }
  }
}

function migrateBookLanguageFields(entity: StoredEntity): StoredEntity {
  return {
    ...entity,
    preferredTitle: typeof entity.preferredTitle === 'string' ? entity.preferredTitle : null,
    languageTag: typeof entity.languageTag === 'string' ? entity.languageTag : 'und',
    titleAliases: Array.isArray(entity.titleAliases) ? entity.titleAliases : [],
    externalReferences: Array.isArray(entity.externalReferences) ? entity.externalReferences : []
  }
}

function migrateBookPublicationFields(entity: StoredEntity): StoredEntity {
  return {
    ...entity,
    publicationKind: entity.publicationKind ?? 'published',
    collectionId: entity.collectionId ?? null,
    sequence: entity.sequence ?? null,
    serialization: entity.serialization ?? null,
    isbn: entity.isbn ?? null,
    publishedOn: entity.publishedOn ?? null
  }
}

export class ReadingCenterDatabase extends Dexie {
  sourceReadingDays!: Table<SourceReadingDay, string>
  works!: Table<Work, string>
  activityLogs!: Table<ActivityLog, string>
  books!: Table<Book, string>
  readingCycles!: Table<ReadingCycle, string>
  readingRecords!: Table<ReadingRecord, string>
  readingContents!: Table<ReadingContent, string>
  dictionaries!: Table<DictionaryEntry, string>
  collections!: Table<BookCollection, string>
  readingGoals!: Table<ReadingGoal, string>
  readingPreferences!: Table<ReadingPreferences, string>
  syncOutbox!: Table<SyncOutboxEntry, number>
  syncConflicts!: Table<SyncConflictRecord, string>
  syncCache!: Table<{ key: string; fingerprint: string | null; revision: number }, string>
  syncReviewArchive!: Table<SyncReviewArchive, string>

  constructor(name = DEFAULT_LOCAL_DATABASE_NAME) {
    super(name)
    this.version(1).stores(versionOneStores)
    this.version(2)
      .stores(versionTwoStores)
      .upgrade(async (transaction) => {
        for (const tableName of Object.keys(versionTwoStores)) {
          await transaction
            .table<StoredEntity>(tableName)
            .toCollection()
            .modify((entity, context) => {
              context.value = migrateMetadata(entity)
            })
        }
      })
    this.version(3).stores(versionThreeStores)
    this.version(4)
      .stores(versionFourStores)
      .upgrade(async (transaction) => {
        await transaction.table<StoredEntity>('books').toCollection().modify((entity, context) => {
          context.value = migrateBookLanguageFields(entity)
        })
      })
    this.version(5)
      .stores(versionFiveStores)
      .upgrade(async (transaction) => {
        await transaction.table<StoredEntity>('books').toCollection().modify((entity, context) => {
          context.value = migrateBookPublicationFields(entity)
        })
      })
    this.version(6).stores(versionSixStores)
    this.version(7).stores(versionSevenStores)
    this.version(8)
      .stores(versionEightStores)
      .upgrade(async (transaction) => {
        const books = await transaction.table<Book>('books').toArray()
        const readingRecords = await transaction.table<ReadingRecord>('readingRecords').toArray()

        if (books.length > 0) {
          await transaction.table<Work>('works').bulkPut(books.map((book) => migrateBookToWork(book)))
        }
        if (readingRecords.length > 0) {
          await transaction
            .table<ActivityLog>('activityLogs')
            .bulkPut(readingRecords.map((record) => migrateReadingRecordToActivityLog(record)))
        }
      })
    this.version(9).stores({ ...versionEightStores, syncCache: '&key' })
    this.version(10).stores({ ...versionEightStores, syncCache: '&key', syncReviewArchive: '&id, resolvedAt' })
    this.version(11).stores({ ...versionEightStores, syncCache: '&key', syncReviewArchive: '&id, resolvedAt', readingGoals: '&id, period, updatedAt' })
    this.version(12).stores({ ...versionEightStores, syncCache: '&key', syncReviewArchive: '&id, resolvedAt', readingGoals: '&id, period, updatedAt', readingPreferences: '&id, updatedAt' })
    this.version(13).stores({ ...versionEightStores, syncCache: '&key', syncReviewArchive: '&id, resolvedAt', readingGoals: '&id, period, updatedAt', readingPreferences: '&id, updatedAt', sourceReadingDays: '&id, date, deviceId, bookId, updatedAt' })
  }
}

export function defineLegacyVersionOne(database: Dexie): void {
  database.version(1).stores(versionOneStores)
}

export function defineLegacyVersionSeven(database: Dexie): void {
  database.version(7).stores(versionSevenStores)
}

