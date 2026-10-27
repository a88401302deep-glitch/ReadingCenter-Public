import {
  assertValidBook,
  assertValidDictionaryEntry,
  assertValidSourceReadingDay,
  createMetadata,
  type Book,
  type DictionaryEntry,
  type SourceReadingDay
} from '../src/domain'
import type { ParsedMoonBackup } from './moon-backup-parser'
import type { D1Database, D1PreparedStatement, D1Result } from './cloudflare-types'
import { planMoonStatistics } from '../src/import/moon-statistics-import'
import { createSourceReadingDayStore } from './source-reading-day-store'

export interface AtomicMoonD1Database extends D1Database {
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>
}

export interface MoonBackupD1Snapshot {
  deviceId: string
  name: string
  backup: Pick<ParsedMoonBackup, 'books' | 'statistics'>
}

export interface MoonBackupD1ImportResult {
  booksCreated: number
  booksMatched: number
  booksPending: number
  statistics: { imported: number; updated: number; skipped: number; duplicateDays: number }
}

interface PayloadRow { payload_json: string | null }
interface SourceDayRow extends PayloadRow { entity_id: string }

const sourceId = 'moon-reader'
const sourceKey = (deviceId: string, path: string): string => JSON.stringify([deviceId, path])
const identity = (value: string): string => value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()

/** Import source records atomically; existing book edits and source-day links are preserved. */
export async function importMoonBackupD1Batch(
  database: AtomicMoonD1Database,
  snapshots: MoonBackupD1Snapshot[],
  now = new Date().toISOString()
): Promise<MoonBackupD1ImportResult> {
  if (!snapshots.length) throw new Error('No Moon+ backups were selected')
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid import timestamp')
  await createSourceReadingDayStore(database)

  const [bookResult, dictionaryResult, sourceDayResult] = await Promise.all([
    database.prepare("SELECT payload_json FROM entities WHERE entity_kind = 'book' AND deleted_at IS NULL").all<PayloadRow>(),
    database.prepare("SELECT payload_json FROM entities WHERE entity_kind = 'dictionary' AND deleted_at IS NULL").all<PayloadRow>(),
    database.prepare("SELECT entity_id, payload_json FROM source_reading_day_entities WHERE deleted_at IS NULL").all<SourceDayRow>()
  ])
  const books = (bookResult.results ?? []).flatMap(row => row.payload_json ? [JSON.parse(row.payload_json) as Book] : [])
  const dictionaries = (dictionaryResult.results ?? []).flatMap(row => row.payload_json ? [JSON.parse(row.payload_json) as DictionaryEntry] : [])
  const existingDays = new Map((sourceDayResult.results ?? []).flatMap(row =>
    row.payload_json ? [[row.entity_id, JSON.parse(row.payload_json) as SourceReadingDay] as const] : []
  ))

  const plannedBooks: Book[] = []
  const plannedAuthors: Extract<DictionaryEntry, { kind: 'author' }>[] = []
  const assignments = new Map<string, string>()
  const handledSources = new Set<string>()
  const pendingSources = new Set<string>()
  let booksMatched = 0
  const allBooks = (): Book[] => [...books, ...plannedBooks]
  const allDictionaries = (): DictionaryEntry[] => [...dictionaries, ...plannedAuthors]
  const authorNames = (book: Book): string[] => book.authorIds
    .map(id => allDictionaries().find(entry => entry.id === id)?.name)
    .filter((name): name is string => Boolean(name))

  const findBookBySource = (deviceId: string, path: string): Book | undefined => {
    const keys = new Set([sourceKey(deviceId, path), deviceId + ':' + path])
    return allBooks().find(book =>
      book.externalReferences.some(reference => reference.sourceId === sourceId && keys.has(reference.externalId))
    )
  }

  const resolveBook = async (title: string, author: string, deviceId: string, path: string): Promise<string | null> => {
    const key = sourceKey(deviceId, path)
    if (handledSources.has(key)) return assignments.get(key) ?? null
    handledSources.add(key)

    const sourceMatch = findBookBySource(deviceId, path)
    if (sourceMatch) {
      assignments.set(key, sourceMatch.id)
      booksMatched++
      return sourceMatch.id
    }

    const titleKey = identity(title)
    const authorKey = identity(author)
    if (!titleKey) {
      pendingSources.add(key)
      return null
    }
    const titleMatches = allBooks().filter(book => identity(book.title) === titleKey)
    const exactMatches = authorKey
      ? titleMatches.filter(book => authorNames(book).some(name => identity(name) === authorKey))
      : []
    const hasUnknownAuthor = titleMatches.some(book => authorNames(book).length === 0)

    if (exactMatches.length === 1 && !hasUnknownAuthor) {
      assignments.set(key, exactMatches[0].id)
      booksMatched++
      return exactMatches[0].id
    }
    if (exactMatches.length > 1 || (titleMatches.length > 0 && (!authorKey || hasUnknownAuthor))) {
      pendingSources.add(key)
      return null
    }

    const authorIds: string[] = []
    if (authorKey) {
      let entry = allDictionaries().find((candidate): candidate is Extract<DictionaryEntry, { kind: 'author' }> =>
        candidate.kind === 'author' && identity(candidate.name) === authorKey
      )
      if (!entry) {
        entry = {
          ...createMetadata({
            id: 'moon:author:' + await hash(authorKey),
            now,
            provenance: { kind: 'import', sourceId, externalId: 'author:' + authorKey, importedAt: now }
          }),
          kind: 'author',
          name: author.trim(),
          color: null,
          aliases: []
        }
        assertValidDictionaryEntry(entry)
        plannedAuthors.push(entry)
      }
      authorIds.push(entry.id)
    }

    const id = 'moon:book:' + await hash(key)
    const book: Book = {
      ...createMetadata({ id, now, provenance: { kind: 'import', sourceId, externalId: 'book:' + key, importedAt: now } }),
      title: title.trim(),
      preferredTitle: null,
      subtitle: null,
      originalTitle: null,
      languageTag: 'und',
      titleAliases: [],
      externalReferences: [{
        sourceId,
        externalId: key,
        sourceTitle: title.trim(),
        sourceAuthorNames: author.trim() ? [author.trim()] : []
      }],
      publicationKind: 'other',
      collectionId: null,
      sequence: null,
      serialization: null,
      isbn: null,
      publishedOn: null,
      authorIds,
      publisherId: null,
      mediaTypeId: 'ebook',
      categoryIds: [],
      tagIds: [],
      sourceIds: [],
      cover: null,
      rating: null,
      sourceUrls: [],
      wordCount: null,
      bookNote: '',
      importSourceNotes: 'Moon+ Reader\nDevice: ' + deviceId + '\nSource path: ' + path + '\nAuthor: ' + (author.trim() || 'unknown')
    }
    assertValidBook(book)
    plannedBooks.push(book)
    assignments.set(key, id)
    return id
  }

  for (const snapshot of snapshots) {
    for (const book of snapshot.backup.books) await resolveBook(book.title, book.author, snapshot.deviceId, book.path)
  }
  for (const snapshot of snapshots) {
    for (const statistic of snapshot.backup.statistics) {
      const book = snapshot.backup.books.find(candidate => candidate.path === statistic.path)
      if (book) await resolveBook(book.title, book.author, snapshot.deviceId, book.path)
    }
  }

  const statisticsPlan = await planMoonStatistics(
    snapshots.map(snapshot => ({
      deviceId: snapshot.deviceId,
      name: snapshot.name,
      statistics: snapshot.backup.statistics
    })),
    new Set(),
    now,
    assignments
  )

  const daysToWrite: Array<{ row: SourceReadingDay; priorRevision: number | null }> = []
  let statisticsUpdated = 0
  let statisticsSkipped = statisticsPlan.duplicateDays
  for (const row of statisticsPlan.rows) {
    const previous = existingDays.get(row.id)
    if (!previous) {
      daysToWrite.push({ row, priorRevision: null })
      continue
    }
    const sameSourceValues = previous.durationMs === row.durationMs &&
      previous.readWords === row.readWords &&
      previous.progressPercent === row.progressPercent
    const nextBookId = previous.bookId ?? row.bookId
    const nextDisputed = previous.completionDisputed || row.completionDisputed
    if (sameSourceValues && previous.backupName === row.backupName &&
      nextBookId === previous.bookId && nextDisputed === previous.completionDisputed) {
      statisticsSkipped++
      continue
    }
    const updated: SourceReadingDay = {
      ...row,
      id: previous.id,
      createdAt: previous.createdAt,
      revision: previous.revision + 1,
      schemaVersion: previous.schemaVersion,
      provenance: previous.provenance,
      updatedAt: now,
      bookId: nextBookId,
      completionDisputed: nextDisputed
    }
    assertValidSourceReadingDay(updated)
    daysToWrite.push({ row: updated, priorRevision: previous.revision })
    statisticsUpdated++
  }

  const statements: D1PreparedStatement[] = []
  const writtenIds: string[] = []
  for (const author of plannedAuthors) statements.push(entityInsert(database, 'dictionary', author, writtenIds))
  for (const book of plannedBooks) statements.push(entityInsert(database, 'book', book, writtenIds))
  let statisticsImported = 0
  for (const { row, priorRevision } of daysToWrite) {
    const mutationId = await dayMutationId(row.id, row.revision)
    if (priorRevision === null) {
      const sql = [
        'INSERT INTO source_reading_day_entities (entity_kind, entity_id, revision, created_at, updated_at, schema_version,',
        'provenance_json, deleted_at, payload_json, last_mutation_id)',
        "VALUES ('sourceReadingDay', ?, ?, ?, ?, ?, ?, NULL, ?, ?) RETURNING entity_id"
      ].join(' ')
      statements.push(database.prepare(sql).bind(
        row.id, row.revision, row.createdAt, row.updatedAt, row.schemaVersion,
        JSON.stringify(row.provenance), JSON.stringify(row), mutationId
      ))
      writtenIds.push(row.id)
      statisticsImported++
    } else {
      const sql = [
        'UPDATE source_reading_day_entities SET revision = ?, updated_at = ?, schema_version = ?,',
        'provenance_json = ?, payload_json = ?, last_mutation_id = ?',
        "WHERE entity_kind = 'sourceReadingDay' AND entity_id = ? AND revision = ? AND deleted_at IS NULL",
        'RETURNING entity_id'
      ].join(' ')
      statements.push(database.prepare(sql).bind(
        row.revision, row.updatedAt, row.schemaVersion, JSON.stringify(row.provenance),
        JSON.stringify(row), mutationId, row.id, priorRevision
      ))
      writtenIds.push(row.id)
    }
  }

  if (statements.length) {
    const results = await database.batch(statements)
    if (results.length !== statements.length || results.some((result, index) =>
      !result.success || result.results?.length !== 1 ||
      (result.results[0] as { entity_id?: string }).entity_id !== writtenIds[index]
    )) throw new Error('Moon+ import commit could not be confirmed; refresh before retrying')
  }

  return {
    booksCreated: plannedBooks.length,
    booksMatched,
    booksPending: pendingSources.size,
    statistics: {
      imported: statisticsImported,
      updated: statisticsUpdated,
      skipped: statisticsSkipped,
      duplicateDays: statisticsPlan.duplicateDays
    }
  }
}

function entityInsert(
  database: AtomicMoonD1Database,
  kind: 'book' | 'dictionary',
  entity: Book | DictionaryEntry,
  writtenIds: string[]
): D1PreparedStatement {
  writtenIds.push(entity.id)
  const sql = [
    'INSERT INTO entities (entity_kind, entity_id, revision, created_at, updated_at, schema_version,',
    'provenance_json, deleted_at, payload_json, last_mutation_id)',
    'VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?) RETURNING entity_id'
  ].join(' ')
  return database.prepare(sql).bind(
    kind, entity.id, entity.revision, entity.createdAt, entity.updatedAt, entity.schemaVersion,
    JSON.stringify(entity.provenance), JSON.stringify(entity),
    'moon-sync:' + kind + ':' + entity.id + ':' + entity.revision
  )
}

async function dayMutationId(id: string, revision: number): Promise<string> {
  return 'moon-sync:sourceReadingDay:' + await hash(id) + ':' + revision
}

async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
