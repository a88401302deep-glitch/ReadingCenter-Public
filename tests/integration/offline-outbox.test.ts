import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateBookToWork, migrateReadingRecordToActivityLog, type Book, type ReadingRecord } from '../../src/domain'
import { createPutOutboxEntry, createSyncingIndexedDbRepositories } from '../../src/data'

const databaseNames = new Set<string>()
const now = '2026-09-15T00:00:00.000Z'

function isolatedDatabaseName(label: string): string {
  const name = `reading-center-outbox-${label}-${crypto.randomUUID()}`
  databaseNames.add(name)
  return name
}

function createBook(id = 'book-1'): Book {
  return {
    id,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    schemaVersion: 1,
    provenance: { kind: 'manual' },
    title: '離線書籍',
    preferredTitle: null,
    subtitle: null,
    languageTag: 'zh-Hant',
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
}

afterEach(async () => {
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('offline sync outbox', () => {
  it('keeps ordered create, update, and delete mutations after reopening', async () => {
    const name = isolatedDatabaseName('persistence')
    const mutationIds = ['mutation-1', 'mutation-2', 'mutation-3']
    const first = createSyncingIndexedDbRepositories(name, {
      createMutationId: () => mutationIds.shift()!,
      now: () => now
    })
    const book = createBook()
    const edited = { ...book, title: '離線編輯', revision: 2, updatedAt: '2026-09-15T01:00:00.000Z' }

    await first.repositories.books.save(book)
    await first.repositories.books.save(edited)
    await first.repositories.books.delete(book.id)
    first.close()

    const reopened = createSyncingIndexedDbRepositories(name)
    expect(await reopened.repositories.books.getById(book.id)).toBeUndefined()
    const entries = await reopened.outbox.getAll()
    expect(entries.map(({ mutationId, operation, baseRevision }) => ({ mutationId, operation, baseRevision }))).toEqual([
      { mutationId: 'mutation-1', operation: 'put', baseRevision: 0 },
      { mutationId: 'mutation-2', operation: 'put', baseRevision: 1 },
      { mutationId: 'mutation-3', operation: 'delete', baseRevision: 2 }
    ])
    expect(entries[1]).toMatchObject({ entity: { title: '離線編輯', createdAt: now } })
    reopened.close()
  })

  it('does not enqueue server hydration through raw repositories', async () => {
    const context = createSyncingIndexedDbRepositories(isolatedDatabaseName('hydration'))
    await context.rawRepositories.books.save(createBook())

    expect(await context.outbox.getAll()).toEqual([])
    expect(await context.repositories.books.getById('book-1')).toMatchObject({ title: '離線書籍' })
    context.close()
  })

  it('rolls back the local write when its outbox mutation cannot be stored', async () => {
    const context = createSyncingIndexedDbRepositories(isolatedDatabaseName('atomic'), {
      createMutationId: () => 'duplicate-mutation',
      now: () => now
    })
    await context.repositories.books.save(createBook('book-1'))

    await expect(context.repositories.books.save(createBook('book-2'))).rejects.toThrow()
    expect(await context.repositories.books.getById('book-2')).toBeUndefined()
    expect(await context.outbox.getAll()).toHaveLength(1)
    context.close()
  })

  it('queues Work and ActivityLog mutations with their remote entity kinds', async () => {
    const mutationIds = ['mutation-work', 'mutation-activity']
    const context = createSyncingIndexedDbRepositories(isolatedDatabaseName('next-generation-sync'), {
      createMutationId: () => mutationIds.shift()!,
      now: () => now
    })
    const book = createBook()
    const record: ReadingRecord = {
      id: 'record-1',
      createdAt: now,
      updatedAt: now,
      revision: 1,
      schemaVersion: 1,
      provenance: { kind: 'manual' },
      bookId: book.id,
      cycleId: null,
      startedAt: now,
      endedAt: null,
      durationMinutes: 20,
      progress: { unit: 'percent', value: 10 },
      deviceId: null,
      sourceId: null
    }

    await context.repositories.works.save(migrateBookToWork(book))
    await context.repositories.activityLogs.save(migrateReadingRecordToActivityLog(record))

    expect((await context.outbox.getAll()).map(({ mutationId, kind, entityId }) => ({
      mutationId,
      kind,
      entityId
    }))).toEqual([
      { mutationId: 'mutation-work', kind: 'work', entityId: book.id },
      { mutationId: 'mutation-activity', kind: 'activityLog', entityId: record.id }
    ])
    expect(await context.repositories.works.getById(book.id)).toBeDefined()
    expect(await context.repositories.activityLogs.getById(record.id)).toBeDefined()
    context.close()
  })

  it('rolls back an approved backfill batch when any mutation is duplicated', async () => {
    const context = createSyncingIndexedDbRepositories(isolatedDatabaseName('backfill-atomic'))
    const firstWork = migrateBookToWork(createBook('book-1'))
    const secondWork = migrateBookToWork(createBook('book-2'))
    const entries = [
      createPutOutboxEntry('work', firstWork, 'duplicate-backfill-mutation', now),
      createPutOutboxEntry('work', secondWork, 'duplicate-backfill-mutation', now)
    ]

    await expect(context.outbox.addMany(entries)).rejects.toThrow()
    expect(await context.outbox.getAll()).toEqual([])
    context.close()
  })

  it('persists sync conflicts after reopening the database', async () => {
    const name = isolatedDatabaseName('conflicts')
    const first = createSyncingIndexedDbRepositories(name)
    const entry = createPutOutboxEntry('book', createBook(), 'mutation-conflict', now)
    await first.conflicts.save({
      mutationId: entry.mutationId,
      kind: entry.kind,
      entityId: entry.entityId,
      reason: 'revision_conflict',
      detectedAt: now,
      local: entry,
      remote: null
    })
    first.close()

    const reopened = createSyncingIndexedDbRepositories(name)
    await expect(reopened.conflicts.getByMutationId(entry.mutationId)).resolves.toMatchObject({
      reason: 'revision_conflict', entityId: 'book-1'
    })
    reopened.close()
  })
})
