import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import {
  migrateBookToWork,
  migrateReadingRecordToActivityLog,
  type ActivityLog,
  type Book,
  type BookCollection,
  type ReadingContent,
  type ReadingCycle,
  type ReadingRecord,
  type Work
} from '../../src/domain'
import {
  createInMemoryRepositories,
  createIndexedDbRepositories,
  defineLegacyVersionOne,
  defineLegacyVersionSeven,
  LOCAL_DATABASE_SCHEMA_VERSION,
  ReadingCenterDatabase,
  type ReadingCenterRepositories
} from '../../src/data'

const now = '2026-09-14T00:00:00.000Z'
const metadata = (id: string) => ({
  id,
  createdAt: now,
  updatedAt: now,
  revision: 1,
  schemaVersion: 1,
  provenance: { kind: 'manual' as const }
})

const book: Book = {
  ...metadata('book-1'),
  title: '測試書籍',
  preferredTitle: null,
  subtitle: null,
  languageTag: 'und',
  titleAliases: [],
  externalReferences: [],
  publicationKind: 'published',
  collectionId: null,
  sequence: null,
  serialization: null,
  isbn: null,
  publishedOn: null,
  originalTitle: null,
  authorIds: [],
  publisherId: null,
  mediaTypeId: 'ebook',
  categoryIds: [],
  tagIds: [],
  sourceIds: [],
  cover: null,
  bookNote: ''
}

const cycle: ReadingCycle = {
  ...metadata('cycle-1'),
  bookId: book.id,
  sequence: 1,
  status: 'reading',
  startedAt: now,
  finishedAt: null,
  abandonedReason: null
}

const collection: BookCollection = {
  ...metadata('collection-1'),
  kind: 'series',
  name: '測試系列'
}

const record: ReadingRecord = {
  ...metadata('record-1'),
  bookId: book.id,
  cycleId: cycle.id,
  startedAt: now,
  endedAt: null,
  durationMinutes: 20,
  progress: { unit: 'percent', value: 10 },
  deviceId: null,
  sourceId: null
}

const content: ReadingContent = {
  ...metadata('content-1'),
  type: 'shortReview',
  bookId: book.id,
  cycleId: cycle.id,
  readingRecordId: record.id,
  recordedForAt: now,
  text: '第一則短評'
}

const work: Work = migrateBookToWork(book)
const activityLog: ActivityLog = migrateReadingRecordToActivityLog(record)
const databaseNames = new Set<string>()

function isolatedDatabaseName(label: string): string {
  const name = `reading-center-test-${label}-${crypto.randomUUID()}`
  databaseNames.add(name)
  return name
}

afterEach(async () => {
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

async function verifyAllRepositories(repositories: ReadingCenterRepositories): Promise<void> {
  const cases = [
    [repositories.works, work],
    [repositories.activityLogs, activityLog],
    [repositories.books, book],
    [repositories.readingCycles, cycle],
    [repositories.readingRecords, record],
    [repositories.readingContents, content],
    [repositories.collections, collection]
  ] as const

  for (const [repository, entity] of cases) {
    await repository.save(entity as never)
    expect(await repository.getById(entity.id)).toEqual(entity)
    expect(await repository.getAll()).toEqual([entity])
    await repository.delete(entity.id)
    expect(await repository.getById(entity.id)).toBeUndefined()
  }
}

describe('repository adapters', () => {
  it('supports all core entities with the in-memory adapter', async () => {
    await verifyAllRepositories(createInMemoryRepositories())
  })

  it('supports all core entities with the IndexedDB adapter', async () => {
    const context = createIndexedDbRepositories(isolatedDatabaseName('crud'))
    await verifyAllRepositories(context.repositories)
    context.close()
  })

  it('keeps data after closing and reopening the database', async () => {
    const name = isolatedDatabaseName('persistence')
    const first = createIndexedDbRepositories(name)
    await first.repositories.books.save(book)
    await first.repositories.works.save(work)
    first.close()

    const reopened = createIndexedDbRepositories(name)
    expect(await reopened.repositories.books.getById(book.id)).toEqual(book)
    expect(await reopened.repositories.works.getById(work.id)).toEqual(work)
    reopened.close()
  })
})

describe('IndexedDB migrations', () => {
  it('migrates legacy metadata in a version-one database', async () => {
    const name = isolatedDatabaseName('migration')
    const legacy = new Dexie(name)
    defineLegacyVersionOne(legacy)
    await legacy.open()
    await legacy.table('books').put({
      ...book,
      preferredTitle: undefined,
      languageTag: undefined,
      titleAliases: undefined,
      externalReferences: undefined,
      publicationKind: undefined,
      collectionId: undefined,
      sequence: undefined,
      serialization: undefined,
      isbn: undefined,
      publishedOn: undefined,
      updatedAt: undefined,
      revision: undefined,
      schemaVersion: undefined,
      provenance: undefined
    })
    legacy.close()

    const migrated = new ReadingCenterDatabase(name)
    await migrated.open()
    const stored = await migrated.books.get(book.id)

    expect(migrated.verno).toBe(LOCAL_DATABASE_SCHEMA_VERSION)
    expect(stored).toMatchObject({
      updatedAt: now,
      revision: 1,
      schemaVersion: 1,
      provenance: { kind: 'manual' }
    })
    expect(stored).toMatchObject({
      preferredTitle: null,
      languageTag: 'und',
      titleAliases: [],
      externalReferences: []
    })
    expect(stored).toMatchObject({
      publicationKind: 'published',
      collectionId: null,
      sequence: null,
      serialization: null,
      isbn: null,
      publishedOn: null
    })
    expect(await migrated.works.get(book.id)).toMatchObject({
      id: book.id,
      title: book.title,
      mediaType: 'book'
    })
    migrated.close()
  })

  it('adds Work and ActivityLog copies while preserving v7 source records', async () => {
    const name = isolatedDatabaseName('v7-to-v8')
    const legacy = new Dexie(name)
    defineLegacyVersionSeven(legacy)
    await legacy.open()
    await legacy.table('books').put(book)
    await legacy.table('readingRecords').put(record)
    legacy.close()

    const migrated = new ReadingCenterDatabase(name)
    await migrated.open()

    expect(migrated.verno).toBe(LOCAL_DATABASE_SCHEMA_VERSION)
    expect(await migrated.books.get(book.id)).toEqual(book)
    expect(await migrated.readingRecords.get(record.id)).toEqual(record)
    expect(await migrated.works.get(book.id)).toEqual(work)
    expect(await migrated.activityLogs.get(record.id)).toEqual(activityLog)
    migrated.close()
  })

  it('rolls back a failed migration without silently deleting legacy data', async () => {
    const name = isolatedDatabaseName('failed-migration')
    const legacy = new Dexie(name)
    defineLegacyVersionOne(legacy)
    await legacy.open()
    await legacy.table('books').put({ ...book, createdAt: undefined })
    legacy.close()

    const current = new ReadingCenterDatabase(name)
    await expect(current.open()).rejects.toThrow('without createdAt')
    current.close()

    const reopenedLegacy = new Dexie(name)
    defineLegacyVersionOne(reopenedLegacy)
    await reopenedLegacy.open()
    expect(await reopenedLegacy.table('books').get(book.id)).toMatchObject({ id: book.id })
    reopenedLegacy.close()
  })
})
