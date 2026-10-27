import type { Table } from 'dexie'
import type {
  ActivityLog,
  Book,
  BookCollection,
  DictionaryEntry,
  EntityId,
  EntityMetadata,
  IsoDateTime,
  ReadingContent,
  ReadingCycle,
  ReadingRecord,
  ReadingGoal,
  ReadingPreferences,
  SourceReadingDay,
  Work
} from '../../domain'
import type { EntityRepository, ReadingCenterRepositories } from '../repository'
import { DEFAULT_LOCAL_DATABASE_NAME, ReadingCenterDatabase } from './database'
import {
  createDeleteOutboxEntry,
  createPutOutboxEntry,
  type SyncEntityKind,
  type SyncOutboxRepository,
  type SyncOutboxWriter,
  type SyncableEntity
} from './sync-outbox'
import type { SyncConflictRecord, SyncConflictRepository } from './sync-conflict'

class IndexedDbRepository<T extends EntityMetadata> implements EntityRepository<T> {
  constructor(private readonly table: Table<T, string>) {}

  async getById(id: EntityId): Promise<T | undefined> {
    return this.table.get(id)
  }

  async getAll(): Promise<T[]> {
    return this.table.toArray()
  }

  async save(entity: T): Promise<void> {
    await this.table.put(entity)
  }

  async delete(id: EntityId): Promise<void> {
    await this.table.delete(id)
  }

  async clear(): Promise<void> {
    await this.table.clear()
  }
}

class SyncingIndexedDbRepository<T extends SyncableEntity> implements EntityRepository<T> {
  constructor(
    private readonly database: ReadingCenterDatabase,
    private readonly table: Table<T, string>,
    private readonly kind: SyncEntityKind,
    private readonly createMutationId: () => string,
    private readonly now: () => IsoDateTime
  ) {}

  async getById(id: EntityId): Promise<T | undefined> {
    return this.table.get(id)
  }

  async getAll(): Promise<T[]> {
    return this.table.toArray()
  }

  async save(entity: T): Promise<void> {
    await this.database.transaction('rw', this.table, this.database.syncOutbox, async () => {
      const existing = await this.table.get(entity.id)
      if (existing && existing.revision !== entity.revision - 1) {
        throw new Error('資料已有新版本；草稿已保留，請核對最新內容後再儲存')
      }
      await this.table.put(entity)
      await this.database.syncOutbox.add(
        createPutOutboxEntry(this.kind, entity, this.createMutationId(), this.now())
      )
    })
  }

  async delete(id: EntityId): Promise<void> {
    await this.database.transaction('rw', this.table, this.database.syncOutbox, async () => {
      const entity = await this.table.get(id)
      if (!entity) return
      const deletedAt = this.now()
      await this.table.delete(id)
      await this.database.syncOutbox.add(
        createDeleteOutboxEntry(this.kind, entity, this.createMutationId(), deletedAt)
      )
    })
  }

  async clear(): Promise<void> {
    await this.database.transaction('rw', this.table, this.database.syncOutbox, async () => {
      const entities = await this.table.toArray()
      for (const entity of entities) {
        const deletedAt = this.now()
        await this.database.syncOutbox.add(
          createDeleteOutboxEntry(this.kind, entity, this.createMutationId(), deletedAt)
        )
      }
      await this.table.clear()
    })
  }
}

class IndexedDbSyncOutboxRepository implements SyncOutboxRepository, SyncOutboxWriter {
  constructor(private readonly database: ReadingCenterDatabase) {}

  async getAll() {
    return this.database.syncOutbox.orderBy('sequence').toArray()
  }

  async addMany(entries: Parameters<SyncOutboxWriter['addMany']>[0]): Promise<void> {
    if (entries.length === 0) return
    await this.database.transaction('rw', this.database.syncOutbox, async () => {
      await this.database.syncOutbox.bulkAdd(entries)
    })
  }

  async remove(mutationId: string): Promise<void> {
    await this.database.syncOutbox.where('mutationId').equals(mutationId).delete()
  }

  async markFailed(mutationId: string, attemptedAt: IsoDateTime, error: string): Promise<void> {
    await this.database.syncOutbox.where('mutationId').equals(mutationId).modify((entry) => {
      entry.attemptCount += 1
      entry.lastAttemptAt = attemptedAt
      entry.lastError = error
    })
  }
}

class IndexedDbSyncConflictRepository implements SyncConflictRepository {
  constructor(private readonly database: ReadingCenterDatabase) {}

  async getAll(): Promise<SyncConflictRecord[]> {
    return this.database.syncConflicts.orderBy('detectedAt').toArray()
  }

  async getByMutationId(mutationId: string): Promise<SyncConflictRecord | undefined> {
    return this.database.syncConflicts.get(mutationId)
  }

  async save(conflict: SyncConflictRecord): Promise<void> {
    await this.database.syncConflicts.put(conflict)
  }

  async remove(mutationId: string): Promise<void> {
    await this.database.syncConflicts.delete(mutationId)
  }
}

export interface LocalRepositoryContext {
  database: ReadingCenterDatabase
  repositories: ReadingCenterRepositories
  close(): void
  deleteDatabase(): Promise<void>
}

export interface SyncingLocalRepositoryContext extends LocalRepositoryContext {
  rawRepositories: ReadingCenterRepositories
  outbox: SyncOutboxRepository & SyncOutboxWriter
  conflicts: SyncConflictRepository
}

export interface SyncingRepositoryOptions {
  createMutationId?: () => string
  now?: () => IsoDateTime
}

function createRawRepositories(database: ReadingCenterDatabase): ReadingCenterRepositories {
  return {
    sourceReadingDays: new IndexedDbRepository<SourceReadingDay>(database.sourceReadingDays),
    transaction: work => database.transaction('rw', database.tables, work),
    works: new IndexedDbRepository<Work>(database.works),
    activityLogs: new IndexedDbRepository<ActivityLog>(database.activityLogs),
    books: new IndexedDbRepository(database.books),
    readingCycles: new IndexedDbRepository(database.readingCycles),
    readingRecords: new IndexedDbRepository(database.readingRecords),
    readingContents: new IndexedDbRepository(database.readingContents),
    dictionaries: new IndexedDbRepository(database.dictionaries),
    collections: new IndexedDbRepository(database.collections),
    readingGoals: new IndexedDbRepository(database.readingGoals),
    readingPreferences: new IndexedDbRepository(database.readingPreferences)
  }
}

export function createIndexedDbRepositories(
  databaseName = DEFAULT_LOCAL_DATABASE_NAME
): LocalRepositoryContext {
  const database = new ReadingCenterDatabase(databaseName)

  return {
    database,
    repositories: createRawRepositories(database),
    close: () => database.close(),
    deleteDatabase: () => database.delete()
  }
}

export function createSyncingIndexedDbRepositories(
  databaseName = DEFAULT_LOCAL_DATABASE_NAME,
  options: SyncingRepositoryOptions = {}
): SyncingLocalRepositoryContext {
  const database = new ReadingCenterDatabase(databaseName)
  const createMutationId = options.createMutationId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date().toISOString())
  const rawRepositories = createRawRepositories(database)

  return {
    database,
    rawRepositories,
    repositories: {
      sourceReadingDays: new SyncingIndexedDbRepository<SourceReadingDay>(database, database.sourceReadingDays, 'sourceReadingDay', createMutationId, now),
      transaction: work => database.transaction('rw', database.tables, work),
      works: new SyncingIndexedDbRepository<Work>(database, database.works, 'work', createMutationId, now),
      activityLogs: new SyncingIndexedDbRepository<ActivityLog>(database, database.activityLogs, 'activityLog', createMutationId, now),
      books: new SyncingIndexedDbRepository<Book>(database, database.books, 'book', createMutationId, now),
      readingCycles: new SyncingIndexedDbRepository<ReadingCycle>(database, database.readingCycles, 'readingCycle', createMutationId, now),
      readingRecords: new SyncingIndexedDbRepository<ReadingRecord>(database, database.readingRecords, 'readingRecord', createMutationId, now),
      readingContents: new SyncingIndexedDbRepository<ReadingContent>(database, database.readingContents, 'readingContent', createMutationId, now),
      dictionaries: new SyncingIndexedDbRepository<DictionaryEntry>(database, database.dictionaries, 'dictionary', createMutationId, now),
      collections: new SyncingIndexedDbRepository<BookCollection>(database, database.collections, 'collection', createMutationId, now),
      readingGoals: new SyncingIndexedDbRepository<ReadingGoal>(database, database.readingGoals, 'readingGoal', createMutationId, now),
      readingPreferences: new SyncingIndexedDbRepository<ReadingPreferences>(database, database.readingPreferences, 'readingPreferences', createMutationId, now)
    },
    outbox: new IndexedDbSyncOutboxRepository(database),
    conflicts: new IndexedDbSyncConflictRepository(database),
    close: () => database.close(),
    deleteDatabase: () => database.delete()
  }
}

