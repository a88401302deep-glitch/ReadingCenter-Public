import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { createMetadata, type Book, type DictionaryEntry, type ReadingCycle } from '../../src/domain'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { buildNotionBulkBatch } from '../../src/import/notion-bulk-batch'
import { buildNotionPilotBatch } from '../../src/import/notion-pilot-batch'
import { stageNotionImport } from '../../src/import/notion-staging'
import { insertNotionPilotBatch, type AtomicD1Database } from '../../worker/notion-import-batch'
import { handleNotionPilotApi } from '../../worker/notion-pilot-api'
import { handleCoverAssetApi } from '../../worker/cover-assets'
import worker from '../../worker/index'
import type { NotionBatchItem } from '../../src/import/notion-pilot-batch'
import type { CoverKV, D1PreparedStatement, D1Result } from '../../worker/cloudflare-types'

const hash = 'a'.repeat(64)
const now = '2026-09-24T00:00:00.000Z'
const provenance = (suffix: string) => ({ kind: 'import' as const, sourceId: 'notion-csv-snapshot', externalId: `${hash}:${suffix}`, importedAt: now })
const publisher: DictionaryEntry = { ...createMetadata({ id: 'notion:publisher:1', now, provenance: provenance('publisher:1') }), kind: 'publisher', name: '讀墨文化', color: null }
const book: Book = {
  ...createMetadata({ id: 'notion:book:2', now, provenance: provenance('2') }),
  title: '測試書', preferredTitle: null, subtitle: null, originalTitle: null,
  languageTag: 'zh-Hant', titleAliases: [], externalReferences: [{ sourceId: 'notion-csv-snapshot', externalId: `${hash}:2`, sourceTitle: '測試書', sourceAuthorNames: [] }],
  publicationKind: 'published', collectionId: null, sequence: null, serialization: null,
  isbn: null, publishedOn: null, authorIds: [], publisherId: publisher.id, mediaTypeId: 'ebook',
  categoryIds: [], tagIds: [], sourceIds: [], cover: null, bookNote: ''
}
const cycle: ReadingCycle = {
  ...createMetadata({ id: 'notion:cycle:2', now, provenance: provenance('2:cycle') }),
  bookId: book.id, sequence: 1, status: 'completed', startedAt: null, finishedAt: null,
  completionDate: { precision: 'date', completedOn: '2022-12-12' }, reportedReadingDays: 5, abandonedReason: null
}
const batch: NotionBatchItem[] = [{ kind: 'readingCycle', entity: cycle }, { kind: 'book', entity: book }, { kind: 'dictionary', entity: publisher }]

describe('isolated Notion D1 pilot batch', () => {
  it('acknowledges inserts with receipt-trigger changes using the production schema', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      for (const file of ['0001_core.sql', '0002_auth_rate_limit.sql', '0003_work_activity_kinds.sql']) {
        sqlite.exec(readFileSync(new URL(`../../migrations/${file}`, import.meta.url), 'utf8'))
      }
      const db = new SqliteAtomicD1Database(sqlite)
      const csv = '書名,作者,閱讀,時間,一行心得,評分,主題,標籤\n批次回應測試,作者,已讀完,2024/02/25,,,,'
      const plan = buildNotionImportPlan(hash, normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv)), {})
      const items = buildNotionBulkBatch(plan, [2], now)
      let acknowledgements: D1Result[] = []
      const checkedDb: AtomicD1Database = {
        prepare: (query) => db.prepare(query),
        batch: async (statements) => { acknowledgements = await db.batch(statements); return acknowledgements }
      }
      const request = () => new Request('https://example.test/api/v1/import/notion/batch', {
        method: 'POST', body: JSON.stringify({ csvSha256: hash, items })
      })
      const response = await handleNotionPilotApi(request(), checkedDb, undefined, true)
      expect(response.status).toBe(201)
      expect((await response.json()).data.status).toBe('inserted')
      expect(acknowledgements.every((result) => result.meta.changes === 2)).toBe(true)
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM entities').get() as { count: number }).count).toBe(items.length)
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM mutation_receipts').get() as { count: number }).count).toBe(items.length)
      expect((await handleNotionPilotApi(request(), checkedDb, undefined, true)).status).toBe(200)
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM entities').get() as { count: number }).count).toBe(items.length)
    } finally { sqlite.close() }
  })

  it('stops on an uncertain post-commit acknowledgement without reporting a source conflict', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const db = new SqliteAtomicD1Database(sqlite)
      const uncertainDb: AtomicD1Database = {
        prepare: (query) => db.prepare(query),
        batch: async (statements) => (await db.batch(statements)).map((result) => ({ ...result, results: [] }))
      }
      const response = await handleNotionPilotApi(new Request('https://example.test/api/v1/import/notion/pilot', {
        method: 'POST', body: JSON.stringify({ csvSha256: hash, items: batch })
      }), uncertainDb)
      expect(response.status).toBe(500)
      expect((await response.json()).error.code).toBe('import_failed')
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM entities').get() as { count: number }).count).toBe(3)
      expect(await insertNotionPilotBatch(db, hash, batch)).toEqual({ status: 'already-applied', inserted: 0 })
    } finally { sqlite.close() }
  })

  it('uploads a versioned cover, serves it, and writes only after checking the stored bytes', async () => {
    const covers = new MemoryCoverKV()
    const image = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])
    const bookId = `notion:book:${hash}:2`
    const upload = await handleCoverAssetApi(new Request('https://example.test/api/v1/covers/notion', {
      method: 'POST', headers: { 'Content-Type': 'image/png', 'X-Book-Id': bookId, 'X-Book-Title': encodeURIComponent('測試書') }, body: image
    }), covers, true)
    expect(upload.status).toBe(201)
    const { data: { cover } } = await upload.json() as { data: { cover: Book['cover'] } }
    expect(cover?.path).toContain(encodeURIComponent(bookId))
    const served = await handleCoverAssetApi(new Request(`https://example.test${cover?.path}`), covers, false)
    expect(served.status).toBe(200)
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(image)
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const db = new SqliteAtomicD1Database(sqlite)
      const coveredBook: Book = { ...book, id: bookId, cover }
      const coveredCycle: ReadingCycle = { ...cycle, bookId }
      const items: NotionBatchItem[] = [{ kind: 'dictionary', entity: publisher }, { kind: 'book', entity: coveredBook }, { kind: 'readingCycle', entity: coveredCycle }]
      expect(await insertNotionPilotBatch(db, hash, items, covers)).toEqual({ status: 'inserted', inserted: 3 })
      expect(await insertNotionPilotBatch(db, hash, items, covers)).toEqual({ status: 'already-applied', inserted: 0 })
      covers.values.set(cover!.path.slice('/api/v1/covers/'.length), new Uint8Array([1, 2, 3]).buffer)
      await expect(insertNotionPilotBatch(db, hash, items, covers)).rejects.toThrow('checksum')
    } finally { sqlite.close() }
  })

  it('requires the selected ZIP cover before converting a source row with a cover', () => {
    const csv = '書名,作者,閱讀,評分,主題,標籤,時間,一行心得,出版社,閱讀時間,封面\n測試書,作者,已讀完,4,小說,溫馨,2024/02/25,讀後感,皇冠文化有限公司,總共閱讀5天,cover.jpg'
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
    const plan = buildNotionImportPlan(hash, rows, {})
    const staging = stageNotionImport(plan)
    expect(() => buildNotionPilotBatch(plan, staging, [2], 'ebook', now)).toThrow('cover review')
    const cover = { path: `/api/v1/covers/covers/${encodeURIComponent(`notion:book:${hash}:2`)}/${'f'.repeat(64)}-test.jpg`, mimeType: 'image/jpeg' as const }
    expect(buildNotionPilotBatch(plan, staging, [2], 'ebook', now, cover).find((item) => item.kind === 'book')?.entity.cover).toEqual(cover)
  })

  it('requires the existing Worker session before the pilot import route', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const response = await worker.fetch(new Request('https://example.test/api/v1/import/notion/pilot', { method: 'POST', body: '{}' }), {
        READING_CENTER_DB: new SqliteAtomicD1Database(sqlite),
        ASSETS: { fetch: async () => new Response('asset') },
        API_ENABLED: 'true', NOTION_PILOT_ENABLED: 'true', AUTH_PASSWORD: 'test-password', AUTH_SESSION_SECRET: 'test-session-secret'
      })
      expect(response.status).toBe(401)
      expect((await response.json()).error.code).toBe('authentication_required')
      const coverResponse = await worker.fetch(new Request('https://example.test/api/v1/covers/notion', { method: 'POST', body: 'image' }), {
        READING_CENTER_DB: new SqliteAtomicD1Database(sqlite), READING_CENTER_COVERS: new MemoryCoverKV(),
        ASSETS: { fetch: async () => new Response('asset') },
        API_ENABLED: 'true', NOTION_PILOT_ENABLED: 'true', AUTH_PASSWORD: 'test-password', AUTH_SESSION_SECRET: 'test-session-secret'
      })
      expect(coverResponse.status).toBe(401)
    } finally { sqlite.close() }
  })

  it('exposes a bounded authenticated-Worker-only request handler with replay responses', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const db = new SqliteAtomicD1Database(sqlite)
      const request = () => new Request('https://example.test/api/v1/import/notion/pilot', {
        method: 'POST', body: JSON.stringify({ csvSha256: hash, items: batch })
      })
      const created = await handleNotionPilotApi(request(), db)
      expect(created.status).toBe(201)
      expect(created.headers.get('Cache-Control')).toBe('no-store')
      expect((await created.json()).data.status).toBe('inserted')
      const replayed = await handleNotionPilotApi(request(), db)
      expect(replayed.status).toBe(200)
      expect((await replayed.json()).data.status).toBe('already-applied')
      expect((await handleNotionPilotApi(new Request('https://example.test/api/v1/import/notion/pilot'), db)).status).toBe(405)
      expect((await handleNotionPilotApi(new Request('https://example.test/api/v1/import/notion/pilot', { method: 'POST', body: '{' }), db)).status).toBe(400)
    } finally { sqlite.close() }
  })

  it('writes a reviewed source row with publisher, category, tag, reading days and confirmed completion', async () => {
    const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,出版社,閱讀時間',
      '測試書,作者,已讀完,4,小說,溫馨,2024/02/25,讀後感,皇冠文化有限公司,總共閱讀5天'].join('\n')
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
    const plan = buildNotionImportPlan(hash, rows, {})
    const proposed = buildNotionPilotBatch(plan, stageNotionImport(plan), [2], 'ebook', now)
    expect(proposed.find((item) => item.kind === 'book')?.entity.id.startsWith('preview:')).toBe(false)
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const db = new SqliteAtomicD1Database(sqlite)
      expect((await insertNotionPilotBatch(db, hash, proposed)).status).toBe('inserted')
      expect((await insertNotionPilotBatch(db, hash, proposed)).status).toBe('already-applied')
      const persisted = sqlite.prepare('SELECT entity_kind, payload_json FROM entities').all() as { entity_kind: string; payload_json: string }[]
      const books = persisted.filter((row) => row.entity_kind === 'book').map((row) => JSON.parse(row.payload_json) as Book)
      const dictionaries = persisted.filter((row) => row.entity_kind === 'dictionary').map((row) => JSON.parse(row.payload_json) as DictionaryEntry)
      const cycles = persisted.filter((row) => row.entity_kind === 'readingCycle').map((row) => JSON.parse(row.payload_json) as ReadingCycle)
      expect(dictionaries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['皇冠', '小說', '溫馨']))
      expect(books[0].publisherId).toBe(dictionaries.find((entry) => entry.name === '皇冠')?.id)
      expect(cycles[0]).toMatchObject({ bookId: books[0].id, reportedReadingDays: 5, completionDate: { completedOn: '2024-02-25' } })
    } finally { sqlite.close() }
  })
  it('keeps an unverified publisher out of the writable pilot', () => {
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview('書名,作者,閱讀,評分,主題,標籤,時間,一行心得,出版社,閱讀時間\n測試書,作者,已讀完,4,小說,溫馨,2024/02/25,讀後感,未核對的私人出版社名稱,總共閱讀5天'))
    const plan = buildNotionImportPlan(hash, rows, {})
    expect(() => buildNotionPilotBatch(plan, stageNotionImport(plan), [2], 'ebook', now)).toThrow('publisher review')
  })
  it('writes metadata, book and confirmed completion once, then treats replay as already applied', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const db = new SqliteAtomicD1Database(sqlite)
      expect(await insertNotionPilotBatch(db, hash, batch)).toEqual({ status: 'inserted', inserted: 3 })
      expect(await insertNotionPilotBatch(db, hash, batch)).toEqual({ status: 'already-applied', inserted: 0 })
      const rows = sqlite.prepare('SELECT entity_kind, payload_json FROM entities ORDER BY entity_kind').all() as { entity_kind: string; payload_json: string }[]
      expect(rows.map((row) => row.entity_kind)).toEqual(['book', 'dictionary', 'readingCycle'])
      expect(JSON.parse(rows[2].payload_json).completionDate.completedOn).toBe('2022-12-12')
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM mutation_receipts').get() as { count: number }).count).toBe(3)
    } finally { sqlite.close() }
  })

  it('rolls back the whole batch if a later record fails', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      sqlite.exec("CREATE TRIGGER reject_cycle BEFORE INSERT ON entities WHEN NEW.entity_kind = 'readingCycle' BEGIN SELECT RAISE(ABORT, 'test failure'); END;")
      await expect(insertNotionPilotBatch(new SqliteAtomicD1Database(sqlite), hash, batch)).rejects.toThrow('test failure')
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM entities').get() as { count: number }).count).toBe(0)
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM mutation_receipts').get() as { count: number }).count).toBe(0)
    } finally { sqlite.close() }
  })

  it('rejects unresolved media and changes to an already imported entity', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const db = new SqliteAtomicD1Database(sqlite)
      await expect(insertNotionPilotBatch(db, hash, [{ kind: 'book', entity: { ...book, mediaTypeId: 'unmapped' } }, { kind: 'readingCycle', entity: cycle }])).rejects.toThrow('resolved media type')
      await insertNotionPilotBatch(db, hash, batch)
      await expect(insertNotionPilotBatch(db, hash, [{ kind: 'book', entity: { ...book, title: '其他書名' } }, { kind: 'dictionary', entity: publisher }, { kind: 'readingCycle', entity: cycle }])).rejects.toThrow('differs')
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM entities').get() as { count: number }).count).toBe(3)
    } finally { sqlite.close() }
  })

  it('stops before writing if the destination already contains a same-title book', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      sqlite.prepare(`INSERT INTO entities (entity_kind, entity_id, revision, created_at, updated_at, schema_version, provenance_json, deleted_at, payload_json, last_mutation_id)
        VALUES ('book', 'manual-book', 1, ?, ?, 1, ?, NULL, ?, 'manual:book:create')`).run(now, now, JSON.stringify({ kind: 'manual' }), JSON.stringify({ id: 'manual-book', title: book.title }))
      await expect(insertNotionPilotBatch(new SqliteAtomicD1Database(sqlite), hash, batch)).rejects.toThrow('same-title')
      expect((sqlite.prepare('SELECT COUNT(*) AS count FROM entities').get() as { count: number }).count).toBe(1)
    } finally { sqlite.close() }
  })

  it('reuses a manual publisher without creating a second entry, including on replay', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      sqlite.prepare(`INSERT INTO entities (entity_kind, entity_id, revision, created_at, updated_at, schema_version, provenance_json, deleted_at, payload_json, last_mutation_id)
        VALUES ('dictionary', 'manual-publisher', 1, ?, ?, 1, ?, NULL, ?, 'manual:publisher:create')`).run(now, now, JSON.stringify({ kind: 'manual' }), JSON.stringify({ id: 'manual-publisher', kind: 'publisher', name: '讀墨文化' }))
      const db = new SqliteAtomicD1Database(sqlite)
      expect(await insertNotionPilotBatch(db, hash, batch)).toEqual({ status: 'inserted', inserted: 2 })
      expect(await insertNotionPilotBatch(db, hash, batch)).toEqual({ status: 'already-applied', inserted: 0 })
      const storedBook = sqlite.prepare("SELECT payload_json FROM entities WHERE entity_kind = 'book'").get() as { payload_json: string }
      expect((JSON.parse(storedBook.payload_json) as Book).publisherId).toBe('manual-publisher')
      expect((sqlite.prepare("SELECT COUNT(*) AS count FROM entities WHERE entity_kind = 'dictionary'").get() as { count: number }).count).toBe(1)
    } finally { sqlite.close() }
  })

  it('imports the next distinct book while reusing dictionaries from the first pilot', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const db = new SqliteAtomicD1Database(sqlite)
      await insertNotionPilotBatch(db, hash, batch)
      const nextBook: Book = { ...book, id: 'notion:book:3', title: '下一本書', provenance: provenance('3'), externalReferences: [{ sourceId: 'notion-csv-snapshot', externalId: `${hash}:3`, sourceTitle: '下一本書', sourceAuthorNames: [] }] }
      const nextCycle: ReadingCycle = { ...cycle, id: 'notion:cycle:3', bookId: nextBook.id, provenance: provenance('3:cycle') }
      const nextPublisher: DictionaryEntry = { ...publisher, id: 'notion:publisher:3', provenance: provenance('publisher:3') }
      const second: NotionBatchItem[] = [{ kind: 'dictionary', entity: nextPublisher }, { kind: 'book', entity: { ...nextBook, publisherId: nextPublisher.id } }, { kind: 'readingCycle', entity: nextCycle }]
      expect(await insertNotionPilotBatch(db, hash, second)).toEqual({ status: 'inserted', inserted: 2 })
      expect(await insertNotionPilotBatch(db, hash, second)).toEqual({ status: 'already-applied', inserted: 0 })
      expect((sqlite.prepare("SELECT COUNT(*) AS count FROM entities WHERE entity_kind = 'dictionary'").get() as { count: number }).count).toBe(1)
      const storedNextBook = sqlite.prepare("SELECT payload_json FROM entities WHERE entity_kind = 'book' AND entity_id = 'notion:book:3'").get() as { payload_json: string }
      expect((JSON.parse(storedNextBook.payload_json) as Book).publisherId).toBe(publisher.id)
    } finally { sqlite.close() }
  })

  it('migrates same-title sources separately and resumes without overwriting manual edits', async () => {
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview('書名,作者,閱讀,時間,一行心得,評分,主題,標籤\n同名,作者,已讀完,2024/02/25,短評,,,\n同名,作者,閱讀中,,另一筆,,,'))
    const plan = buildNotionImportPlan(hash, rows, {})
    const first = buildNotionBulkBatch(plan, [2], now)
    const second = buildNotionBulkBatch(plan, [3], now)
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const db = new SqliteAtomicD1Database(sqlite)
      await insertNotionPilotBatch(db, hash, first, undefined, true)
      await insertNotionPilotBatch(db, hash, second, undefined, true)
      expect((sqlite.prepare("SELECT COUNT(*) AS count FROM entities WHERE entity_kind = 'book'").get() as { count: number }).count).toBe(2)
      const id = `notion:book:${hash}:2`
      const stored = JSON.parse((sqlite.prepare("SELECT payload_json FROM entities WHERE entity_id = ?").get(id) as { payload_json: string }).payload_json)
      stored.bookNote = '人工修改，不可覆蓋'
      stored.revision = 2
      sqlite.prepare("UPDATE entities SET payload_json = ?, revision = 2, last_mutation_id = 'manual:migration-edit' WHERE entity_id = ?").run(JSON.stringify(stored), id)
      expect(await insertNotionPilotBatch(db, hash, buildNotionBulkBatch(plan, [2], '2026-10-02T00:00:00Z'), undefined, true)).toEqual({ status: 'already-applied', inserted: 0 })
      expect(JSON.parse((sqlite.prepare('SELECT payload_json FROM entities WHERE entity_id = ?').get(id) as { payload_json: string }).payload_json).bookNote).toBe('人工修改，不可覆蓋')
      sqlite.prepare("UPDATE entities SET deleted_at = ?, payload_json = NULL, revision = 3, last_mutation_id = 'manual:migration-delete' WHERE entity_id = ?").run(now, id)
      await expect(insertNotionPilotBatch(db, hash, first, undefined, true)).rejects.toThrow('deleted')
    } finally { sqlite.close() }
  })

  it('requires login and the existing import gate for the migration route', async () => {
    const env = { ASSETS: { fetch: async () => new Response('asset') }, API_ENABLED: 'true', NOTION_PILOT_ENABLED: 'true', AUTH_PASSWORD: 'password', AUTH_SESSION_SECRET: 'session-secret' }
    const response = await worker.fetch(new Request('https://example.test/api/v1/import/notion/batch', { method: 'POST', body: '{}' }), env)
    expect(response.status).toBe(401)
  })

})

class SqliteAtomicD1Database implements AtomicD1Database {
  constructor(private readonly db: DatabaseSync) {}
  prepare(query: string): D1PreparedStatement { return new SqliteStatement(this.db.prepare(query), this.db) }
  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    this.db.exec('BEGIN')
    try {
      const results = await Promise.all(statements.map((statement) => statement.run()))
      this.db.exec('COMMIT')
      return results
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}

class SqliteStatement implements D1PreparedStatement {
  private values: SQLInputValue[] = []
  constructor(private readonly statement: StatementSync, private readonly db: DatabaseSync) {}
  bind(...values: unknown[]): D1PreparedStatement { this.values = values as SQLInputValue[]; return this }
  async first<T = Record<string, unknown>>(): Promise<T | null> { return (this.statement.get(...this.values) as T | undefined) ?? null }
  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> { return { results: this.statement.all(...this.values) as T[], success: true, meta: {} } }
  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const totalChanges = () => Number((this.db.prepare('SELECT total_changes() AS count').get() as { count: number }).count)
    const before = totalChanges()
    const results = this.statement.all(...this.values) as T[]
    return { results, success: true, meta: { changes: totalChanges() - before } }
  }
}

class MemoryCoverKV implements CoverKV {
  values = new Map<string, ArrayBuffer>()
  async get(key: string): Promise<ArrayBuffer | null> { return this.values.get(key) ?? null }
  async put(key: string, value: ArrayBuffer): Promise<void> { this.values.set(key, value) }
}
