import { assertValidBook, assertValidDictionaryEntry, createMetadata, updateEntity, type BookCover, type Book, type DictionaryEntry } from '../domain'
import type { ReadingCenterRepositories } from '../data'
import type { MoonBackup } from './moon-backup-reader'
import { persistMoonStatisticsPlan, planMoonStatistics } from './moon-statistics-import'
import { moonSourceTitle } from './moon-book-matching'

export interface MoonBackupBatchSnapshot {
  deviceId: string
  name: string
  backup: Pick<MoonBackup, 'books' | 'statistics'> & Partial<Pick<MoonBackup, 'readCover'>>
}
export interface MoonBackupBatchResult {
  booksCreated: number
  booksMatched: number
  booksPending: number
  coversSaved: number
  coverWarnings: string[]
  statistics: { imported: number; skipped: number }
}
const identity = (value: string) => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const sourceKey = (deviceId: string, path: string) => JSON.stringify([deviceId, path])
const sourceId = 'moon-reader'

/**
 * Imports a complete Moon+ batch in one repository transaction. A unique
 * title+author match links automatically; absent titles create books; title
 * collisions without enough author evidence remain unpaired for review.
 */
export async function importMoonBackupBatch(
  repositories: ReadingCenterRepositories,
  snapshots: MoonBackupBatchSnapshot[],
  disputedPaths: ReadonlySet<string> = new Set(),
  now = new Date().toISOString(),
  options: { saveCover?: (book: Book, blob: Blob) => Promise<BookCover> } = {}
): Promise<MoonBackupBatchResult> {
  if (!snapshots.length) throw new Error('沒有選取靜讀天下備份')
  // Resolve metadata and validate the full statistics batch before the write transaction.
  const [books, dictionaries, storedDays] = await Promise.all([repositories.books.getAll(), repositories.dictionaries.getAll(), repositories.sourceReadingDays.getAll()])
  const authors = dictionaries.filter((entry): entry is Extract<DictionaryEntry, { kind: 'author' }> => entry.kind === 'author')
  const plannedBooks: Book[] = []
  const plannedAuthors: Extract<DictionaryEntry, { kind: 'author' }>[] = []
  const sourceAssignments = new Map<string, string>()
  const handledSources = new Set<string>()
  let booksMatched = 0
  const pendingKeys = new Set<string>()
  const allBooks = () => [...books, ...plannedBooks]
  const allAuthors = () => [...authors, ...plannedAuthors]
  const authorNames = (book: Book) => book.authorIds.map(id => allAuthors().find(entry => entry.id === id)?.name).filter((name): name is string => Boolean(name))
  const resolve = (title: string, author: string, deviceId: string, path: string): string | null => {
    const key = sourceKey(deviceId, path)
    if (handledSources.has(key)) return sourceAssignments.get(key) ?? null
    handledSources.add(key)
    const references = allBooks().filter(book => book.externalReferences.some(ref => ref.sourceId === sourceId && ref.externalId === `${deviceId}:${path}`))
    const assignedIds = new Set(storedDays.filter(row => row.deviceId === deviceId && row.sourcePath === path && row.bookId).map(row => row.bookId))
    const previouslyAssigned = allBooks().filter(book => assignedIds.has(book.id))
    const knownMatches = previouslyAssigned.length ? previouslyAssigned : references
    if (knownMatches.length === 1) { sourceAssignments.set(key, knownMatches[0].id); booksMatched++; return knownMatches[0].id }
    if (knownMatches.length > 1) { pendingKeys.add(key); return null }
    const titleKey = identity(title)
    const authorKey = identity(author)
    if (!titleKey) { pendingKeys.add(key); return null }
    const titleMatches = allBooks().filter(book => identity(book.title) === titleKey)
    const exactMatches = authorKey
      ? titleMatches.filter(book => authorNames(book).some(name => identity(name) === authorKey))
      : []
    const hasUnknownAuthor = titleMatches.some(book => authorNames(book).length === 0)
    if (exactMatches.length === 1 && !hasUnknownAuthor) {
      sourceAssignments.set(key, exactMatches[0].id)
      booksMatched++
      return exactMatches[0].id
    }
    if (exactMatches.length > 1 || (titleMatches.length > 0 && (!authorKey || hasUnknownAuthor))) {
      pendingKeys.add(key)
      return null
    }
    const authorIds: string[] = []
    if (authorKey) {
      let entry = allAuthors().find(item => identity(item.name) === authorKey)
      if (!entry) {
        entry = {
          ...createMetadata({ id: crypto.randomUUID(), now, provenance: { kind: 'import', sourceId, externalId: `author:${authorKey}`, importedAt: now } }),
          kind: 'author', name: author.trim(), color: null, aliases: []
        }
        assertValidDictionaryEntry(entry)
        plannedAuthors.push(entry)
      }
      authorIds.push(entry.id)
    }
    const id = crypto.randomUUID()
    const book: Book = {
      ...createMetadata({ id, now, provenance: { kind: 'import', sourceId, externalId: `book:${identity(title)}|${authorKey}`, importedAt: now } }),
      title: title.trim(), preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'und', titleAliases: [],
      externalReferences: [{ sourceId, externalId: `${deviceId}:${path}`, sourceTitle: title.trim(), sourceAuthorNames: author.trim() ? [author.trim()] : [] }],
      publicationKind: 'other', collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null,
      authorIds, publisherId: null, mediaTypeId: 'ebook', categoryIds: [], tagIds: [], sourceIds: [], cover: null,
      rating: null, sourceUrls: [], wordCount: null, bookNote: '',
      importSourceNotes: `Moon+ Reader 匯入\n裝置：${deviceId}\n來源路徑：${path}\n作者：${author.trim() || '未提供'}`
    }
    assertValidBook(book)
    plannedBooks.push(book)
    sourceAssignments.set(key, id)
    return id
  }

  for (const snapshot of snapshots) for (const moonBook of snapshot.backup.books) resolve(moonBook.title, moonBook.author, snapshot.deviceId, moonBook.path)
  for (const snapshot of snapshots) for (const statistic of snapshot.backup.statistics) {
    const matchingBook = snapshot.backup.books.find(book => book.path === statistic.path)
    if (matchingBook) resolve(matchingBook.title, matchingBook.author, snapshot.deviceId, matchingBook.path)
    else resolve(moonSourceTitle(statistic.path), '', snapshot.deviceId, statistic.path)
  }
  const statisticsPlan = await planMoonStatistics(
    snapshots.map(snapshot => ({ deviceId: snapshot.deviceId, name: snapshot.name, statistics: snapshot.backup.statistics })),
    disputedPaths,
    now,
    sourceAssignments
  )
  // Upload outside the IndexedDB transaction; never keep a transaction open across network I/O.
  const coverUpdates = new Map<string, BookCover>()
  const coverWarnings: string[] = []
  if (options.saveCover) for (const snapshot of snapshots) for (const moonBook of snapshot.backup.books) {
    const id = sourceAssignments.get(sourceKey(snapshot.deviceId, moonBook.path))
    const book = allBooks().find(item => item.id === id)
    if (!book || book.cover || coverUpdates.has(book.id) || !moonBook.coverPath || !snapshot.backup.readCover) continue
    try { coverUpdates.set(book.id, await options.saveCover(book, await snapshot.backup.readCover(moonBook.coverPath))) }
    catch (reason) { coverWarnings.push(`${moonBook.title}：${reason instanceof Error ? reason.message : '封面保存失敗'}`) }
  }
  const persist = async (): Promise<MoonBackupBatchResult> => {
    for (const entry of plannedAuthors) await repositories.dictionaries.save(entry)
    for (const book of plannedBooks) await repositories.books.save(coverUpdates.has(book.id) ? { ...book, cover: coverUpdates.get(book.id)! } : book)
    for (const [id, cover] of coverUpdates) {
      if (plannedBooks.some(book => book.id === id)) continue
      const current = await repositories.books.getById(id)
      if (current && !current.cover) await repositories.books.save(updateEntity(current, { cover }, now))
    }
    const statistics = await persistMoonStatisticsPlan(repositories, statisticsPlan, now)
    return { booksCreated: plannedBooks.length, booksMatched, booksPending: pendingKeys.size, coversSaved: coverUpdates.size, coverWarnings, statistics }
  }
  return repositories.transaction ? repositories.transaction(persist) : persist()
}

