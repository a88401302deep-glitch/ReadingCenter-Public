import { describe, expect, it } from 'vitest'
import type { Book, Provenance } from '../../src/domain'
import { createInMemoryRepositories } from '../../src/data'
import {
  createEnvelope,
  createTombstone,
  oneDriveFormatVersion,
  parseSnapshot,
  rebuildCoreCache,
  resolveConflict,
  serializeSnapshot,
  type OneDriveSnapshot
} from '../../src/sync'

const makeBook = (
  title = '人工書名',
  provenance: Provenance = { kind: 'manual' },
  revision = 1,
  updatedAt = '2026-09-15T00:00:00.000Z'
): Book => ({
  id: 'book-1',
  createdAt: '2026-09-15T00:00:00.000Z',
  updatedAt,
  revision,
  schemaVersion: 1,
  provenance,
  title,
  preferredTitle: null,
  subtitle: null,
  originalTitle: null,
  languageTag: 'zh-Hant',
  titleAliases: [],
  externalReferences: [],
  publicationKind: 'published',
  collectionId: null,
  sequence: null,
  serialization: null,
  isbn: null,
  publishedOn: null,
  authorIds: [],
  publisherId: null,
  mediaTypeId: 'ebook',
  categoryIds: [],
  tagIds: [],
  sourceIds: [],
  cover: null,
  bookNote: ''
})

const makeSnapshot = (bookEnvelope = createEnvelope('book', makeBook())): OneDriveSnapshot => ({
  manifest: {
    formatVersion: oneDriveFormatVersion,
    schemaVersion: 1,
    snapshotId: 'snapshot-1',
    generatedAt: '2026-09-15T01:00:00.000Z',
    entityFiles: {
      book: 'data/books.json',
      readingCycle: 'data/reading-cycles.json',
      readingRecord: 'data/reading-records.json',
      readingContent: 'data/reading-contents.json'
    }
  },
  entities: {
    book: [bookEnvelope],
    readingCycle: [],
    readingRecord: [],
    readingContent: []
  }
})

describe('OneDrive snapshot contracts', () => {
  it('serializes and validates a versioned snapshot deterministically', () => {
    const serialized = serializeSnapshot(makeSnapshot())
    expect(parseSnapshot(serialized)).toEqual(makeSnapshot())
    expect(serializeSnapshot(parseSnapshot(serialized))).toBe(serialized)
  })

  it('rejects incompatible or corrupt data before clearing the cache', async () => {
    const repositories = createInMemoryRepositories()
    await repositories.books.save(makeBook('既有快取'))

    const incompatible = makeSnapshot() as unknown as { manifest: { formatVersion: number } }
    incompatible.manifest.formatVersion = 99

    await expect(rebuildCoreCache(repositories, incompatible as never)).rejects.toThrow(
      'Unsupported OneDrive snapshot format version'
    )
    await expect(repositories.books.getById('book-1')).resolves.toMatchObject({ title: '既有快取' })
    expect(() => parseSnapshot('{broken')).toThrow('not valid JSON')
  })

  it('rebuilds cache idempotently and does not restore tombstoned entities', async () => {
    const repositories = createInMemoryRepositories()
    const live = makeSnapshot()
    await rebuildCoreCache(repositories, live)
    await rebuildCoreCache(repositories, live)
    await expect(repositories.books.getAll()).resolves.toHaveLength(1)

    const deleted = makeSnapshot(
      createTombstone('book', makeBook(), '2026-09-15T02:00:00.000Z')
    )
    await rebuildCoreCache(repositories, deleted)
    await expect(repositories.books.getAll()).resolves.toEqual([])
  })

  it('keeps manual data ahead of newer imports and flags concurrent manual edits', () => {
    const manual = createEnvelope('book', makeBook('人工修改'))
    const imported = createEnvelope(
      'book',
      makeBook(
        '來源匯入',
        { kind: 'import', sourceId: 'source-1', externalId: 'remote-1', importedAt: '2026-09-15T03:00:00.000Z' },
        9,
        '2026-09-15T03:00:00.000Z'
      )
    )
    const priority = resolveConflict(manual, imported)
    expect(priority.status).toBe('resolved')
    if (priority.status === 'resolved') {
      expect(priority.reason).toBe('manual-priority')
      expect(priority.winner.payload?.title).toBe('人工修改')
    }

    const otherManual = createEnvelope('book', makeBook('另一台裝置的修改'))
    expect(resolveConflict(manual, otherManual)).toMatchObject({
      status: 'conflict',
      reason: 'concurrent-manual'
    })
  })

  it('lets a newer manual tombstone defeat an older live entity', () => {
    const book = makeBook()
    const live = createEnvelope('book', book)
    const tombstone = createTombstone('book', book, '2026-09-15T04:00:00.000Z')
    const result = resolveConflict(live, tombstone)
    expect(result.status).toBe('resolved')
    if (result.status === 'resolved') expect(result.winner.deleted).toBe(true)
  })
})
