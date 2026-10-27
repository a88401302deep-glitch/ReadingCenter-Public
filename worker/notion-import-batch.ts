import { assertValidBook, assertValidDictionaryEntry, assertValidReadingContent, assertValidReadingCycle } from '../src/domain'
import type { NotionBatchItem } from '../src/import/notion-pilot-batch'
import type { CoverKV, D1Database, D1PreparedStatement, D1Result } from './cloudflare-types'
import { verifyStoredPilotCover } from './cover-assets'

export interface AtomicD1Database extends D1Database {
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>
}

const sourceId = 'notion-csv-snapshot'
const order = { dictionary: 0, book: 1, readingCycle: 2, readingContent: 3 }

/** One new, fully reviewed work and its dependent records. */
export async function insertNotionPilotBatch(db: AtomicD1Database, csvSha256: string, items: NotionBatchItem[], covers?: CoverKV, migration = false) {
  if (!/^[0-9a-f]{64}$/.test(csvSha256) || items.length < (migration ? 1 : 2) || items.length > 25) throw new Error('Invalid pilot batch size or snapshot')
  const books = items.filter((item) => item.kind === 'book')
  if (books.length !== 1) throw new Error('Pilot batch requires exactly one book')
  const bookId = books[0].entity.id
  const seen = new Set<string>()
  const dictionaryNames = new Set<string>()
  for (const item of items) {
    const entity = item.entity
    if (entity.id.startsWith('preview:') || seen.has(`${item.kind}:${entity.id}`) || entity.revision !== 1 ||
      entity.provenance.kind !== 'import' || entity.provenance.sourceId !== sourceId ||
      !entity.provenance.externalId.startsWith(`${csvSha256}:`)) throw new Error('Pilot entity identity is invalid')
    seen.add(`${item.kind}:${entity.id}`)
    if (item.kind === 'book') {
      assertValidBook(item.entity)
      if (!(['ebook', 'manga', 'print'].includes(item.entity.mediaTypeId) || (migration && items.some((entry) => entry.kind === 'dictionary' && entry.entity.kind === 'mediaType' && entry.entity.id === item.entity.mediaTypeId))) || !item.entity.externalReferences.length ||
        item.entity.externalReferences.some((ref) => ref.sourceId !== sourceId || !ref.externalId.startsWith(`${csvSha256}:`))) {
        throw new Error('Book requires resolved media type, source keys and cover')
      }
    } else if (item.kind === 'dictionary') {
      assertValidDictionaryEntry(item.entity)
      const key = `${item.entity.kind}:${item.entity.name}`
      if (dictionaryNames.has(key)) throw new Error('Pilot batch contains repeated dictionary names')
      dictionaryNames.add(key)
    }
    else if (item.kind === 'readingCycle') {
      assertValidReadingCycle(item.entity)
      if (item.entity.bookId !== bookId) throw new Error('Cycle does not belong to the pilot book')
    } else {
      assertValidReadingContent(item.entity)
      if (item.entity.bookId !== bookId) throw new Error('Review does not belong to the pilot book')
    }
  }
  if (migration) {
    const proposed = books[0].entity
    if (proposed.provenance.kind !== 'import' || proposed.id !== `notion:book:${proposed.provenance.externalId}`) throw new Error('Pilot entity identity is invalid')
    const stored = await db.prepare("SELECT payload_json, deleted_at FROM entities WHERE entity_kind = 'book' AND entity_id = ?")
      .bind(bookId).first<{ payload_json: string | null; deleted_at: string | null }>()
    if (stored) {
      if (stored.deleted_at !== null || !stored.payload_json) throw new Error('Existing pilot entity was deleted; not restoring it')
      const existingBook = JSON.parse(stored.payload_json) as typeof proposed
      if (proposed.externalReferences.length !== existingBook.externalReferences.length || proposed.externalReferences.some((ref) =>
        !existingBook.externalReferences.some((existing) => existing.sourceId === ref.sourceId && existing.externalId === ref.externalId))) {
        throw new Error('Existing pilot entity has different source references')
      }
      // A prior atomic migration (or the pilot) already inserted the book and dependents.
      // Preserve subsequent manual edits and timestamps; never reapply this snapshot.
      return { status: 'already-applied' as const, inserted: 0 }
    }
  }
  if (books[0].entity.cover) await verifyStoredPilotCover(covers, bookId, books[0].entity.cover)
  const reusedDictionaryIds = new Map<string, string>()
  for (const item of items) {
    if (item.kind !== 'dictionary') continue
    const existingName = await db.prepare(`SELECT entity_id FROM entities WHERE entity_kind = 'dictionary' AND deleted_at IS NULL
      AND json_extract(payload_json, '$.kind') = ? AND json_extract(payload_json, '$.name') = ? LIMIT 1`)
      .bind(item.entity.kind, item.entity.name).first<{ entity_id: string }>()
    if (existingName) reusedDictionaryIds.set(item.entity.id, existingName.entity_id)
  }
  const resolveId = (id: string) => reusedDictionaryIds.get(id) ?? id
  const sorted = items.filter((item) => item.kind !== 'dictionary' || !reusedDictionaryIds.has(item.entity.id))
    .map((item): NotionBatchItem => item.kind === 'book' ? { kind: 'book', entity: {
      ...item.entity, mediaTypeId: resolveId(item.entity.mediaTypeId), authorIds: item.entity.authorIds.map(resolveId),
      publisherId: item.entity.publisherId ? resolveId(item.entity.publisherId) : null,
      categoryIds: item.entity.categoryIds.map(resolveId), tagIds: item.entity.tagIds.map(resolveId),
      sourceIds: item.entity.sourceIds.map(resolveId)
    } } : item).sort((a, b) => order[a.kind] - order[b.kind])
  const pilotBook = books[0].entity
  const sameTitle = migration ? null : await db.prepare("SELECT entity_id FROM entities WHERE entity_kind = 'book' AND deleted_at IS NULL AND json_extract(payload_json, '$.title') = ? AND entity_id <> ? LIMIT 1")
    .bind(pilotBook.title, bookId).first<{ entity_id: string }>()
  if (sameTitle && !migration) throw new Error('Existing same-title book requires review before import')
  for (const reference of pilotBook.externalReferences) {
    const other = await db.prepare(`SELECT entity_id FROM entities WHERE entity_kind = 'book' AND deleted_at IS NULL AND entity_id <> ?
      AND (EXISTS (SELECT 1 FROM json_each(payload_json, '$.externalReferences') WHERE json_extract(value, '$.sourceId') = ? AND json_extract(value, '$.externalId') = ?)
        OR (json_extract(provenance_json, '$.sourceId') = ? AND json_extract(provenance_json, '$.externalId') = ?)) LIMIT 1`)
      .bind(bookId, reference.sourceId, reference.externalId, reference.sourceId, reference.externalId).first<{ entity_id: string }>()
    if (other) throw new Error('Notion source row is already linked to another book')
  }
  const existing = await Promise.all(sorted.map(({ kind, entity }) => db.prepare(
    'SELECT payload_json FROM entities WHERE entity_kind = ? AND entity_id = ? AND deleted_at IS NULL'
  ).bind(kind, entity.id).first<{ payload_json: string }>()))
  for (const [index, row] of existing.entries()) {
    if (row && JSON.stringify(JSON.parse(row.payload_json)) !== JSON.stringify(sorted[index].entity)) throw new Error('Existing pilot entity differs from proposed import')
  }
  if (existing.every(Boolean)) return { status: 'already-applied' as const, inserted: 0 }
  if (existing.some(Boolean)) {
    if (sorted.some((item, index) => item.kind !== 'dictionary' && existing[index])) {
      throw new Error('Partial pilot batch exists; stopped without writing')
    }
  }

  const statements: D1PreparedStatement[] = []
  const insertedIds: string[] = []
  for (const [index, { kind, entity }] of sorted.entries()) {
    if (existing[index]) continue
    insertedIds.push(entity.id)
    const identity = new TextEncoder().encode(`${kind}:${entity.id}`)
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', identity)), (byte) => byte.toString(16).padStart(2, '0')).join('')
    statements.push(db.prepare(`INSERT INTO entities (
      entity_kind, entity_id, revision, created_at, updated_at, schema_version,
      provenance_json, deleted_at, payload_json, last_mutation_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?) RETURNING entity_id`).bind(
      kind, entity.id, entity.revision, entity.createdAt, entity.updatedAt, entity.schemaVersion,
      JSON.stringify(entity.provenance), JSON.stringify(entity), `notion:${hash}`
    ))
  }
  const results = await db.batch(statements)
  // D1 changes includes receipt triggers; confirm the inserted identity instead.
  if (results.length !== statements.length || results.some((result, index) =>
    !result.success || result.results?.length !== 1 ||
    (result.results[0] as { entity_id?: string }).entity_id !== insertedIds[index])) {
    // The batch may already be committed. Treat uncertain acknowledgements as a
    // server failure so clients stop instead of repeating this across every row.
    throw new Error('Import commit could not be confirmed; refresh the library before retrying')
  }
  return { status: 'inserted' as const, inserted: statements.length }
}
