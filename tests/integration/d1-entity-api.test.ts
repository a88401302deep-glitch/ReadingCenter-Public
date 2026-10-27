import { readFileSync } from 'node:fs'
import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { handleEntityApi, type RemoteEntity, type RemoteEntityStore } from '../../src/server/entity-api'
import type { D1Database, D1PreparedStatement, D1Result } from '../../worker/cloudflare-types'
import { D1EntityStore } from '../../worker/d1-entity-store'

const firstAt = '2026-09-15T00:00:00.000Z'
const secondAt = '2026-09-15T01:00:00.000Z'
const thirdAt = '2026-09-15T02:00:00.000Z'

describe('D1 entity API integration', () => {
  it('uses the production schema for CRUD, receipts, tombstones and manual-data protection', async () => {
    const sqlite = new DatabaseSync(':memory:')
    try {
      sqlite.exec(readFileSync(new URL('../../migrations/0001_core.sql', import.meta.url), 'utf8'))
      const store = new D1EntityStore(new SqliteD1Database(sqlite))

      const createdBook = await call(store, 'PUT', '/api/v1/entities/book/book-1', {
        mutationId: 'mutation:book:create',
        baseRevision: 0,
        entity: book()
      })
      expect(createdBook.status).toBe(201)

      const blockedImport = await call(store, 'PUT', '/api/v1/entities/book/book-1', {
        mutationId: 'mutation:book:import',
        baseRevision: 1,
        entity: book({
          title: '匯入資料不應覆蓋',
          updatedAt: secondAt,
          revision: 2,
          provenance: {
            kind: 'import',
            sourceId: 'source-1',
            externalId: 'external-book-1',
            importedAt: secondAt
          }
        })
      })
      expect(blockedImport.status).toBe(409)
      expect((await blockedImport.json()).error.code).toBe('manual_data_protected')

      const updatedBook = await call(store, 'PUT', '/api/v1/entities/book/book-1', {
        mutationId: 'mutation:book:update',
        baseRevision: 1,
        entity: book({ title: '人工更新書名', createdAt: secondAt, updatedAt: secondAt, revision: 2 })
      })
      const updatedBookBody = await updatedBook.json()
      expect(updatedBookBody.data.createdAt).toBe(firstAt)
      expect(updatedBookBody.data.payload.title).toBe('人工更新書名')

      await call(store, 'PUT', '/api/v1/entities/readingContent/content-1', {
        mutationId: 'mutation:content:create',
        baseRevision: 0,
        entity: readingContent()
      })
      const updatedContent = await call(store, 'PUT', '/api/v1/entities/readingContent/content-1', {
        mutationId: 'mutation:content:update',
        baseRevision: 1,
        entity: readingContent({ text: '編輯後短評', createdAt: secondAt, updatedAt: secondAt, revision: 2 })
      })
      expect((await updatedContent.json()).data.createdAt).toBe(firstAt)

      const deletedContent = await call(store, 'DELETE', '/api/v1/entities/readingContent/content-1', {
        mutationId: 'mutation:content:delete',
        baseRevision: 2,
        deletedAt: thirdAt
      })
      expect((await deletedContent.json()).data.deletedAt).toBe(thirdAt)
      expect((await call(store, 'GET', '/api/v1/entities/readingContent/content-1')).status).toBe(404)

      const tombstone = await call(store, 'GET', '/api/v1/entities/readingContent/content-1?includeDeleted=true')
      expect((await tombstone.json()).data.payload).toBeNull()

      const receipt = sqlite.prepare('SELECT COUNT(*) AS count FROM mutation_receipts').get() as { count: number }
      expect(receipt.count).toBe(5)
    } finally {
      sqlite.close()
    }
  })

  it('returns a stable non-destructive error when the storage limit is reached', async () => {
    const storageFailure = new Error('D1_ERROR: storage quota has been exceeded')
    const failingStore: RemoteEntityStore = {
      get: async () => { throw storageFailure },
      list: async () => { throw storageFailure },
      put: async () => { throw storageFailure },
      delete: async () => { throw storageFailure }
    }

    const response = await call(failingStore, 'GET', '/api/v1/entities/book/book-1')
    const body = await response.json()
    expect(response.status).toBe(507)
    expect(body.error).toEqual({
      code: 'storage_limit_reached',
      message: 'Cloud storage limit reached; no data was changed'
    })
  })
})

async function call(store: RemoteEntityStore, method: string, path: string, body?: unknown): Promise<Response> {
  return handleEntityApi(new Request(`https://reading.example${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  }), store)
}

function book(changes: Partial<RemoteEntity> = {}): RemoteEntity {
  return {
    id: 'book-1',
    title: '測試書籍',
    mediaTypeId: 'media-book',
    createdAt: firstAt,
    updatedAt: firstAt,
    revision: 1,
    schemaVersion: 1,
    provenance: { kind: 'manual' },
    ...changes
  }
}

function readingContent(changes: Partial<RemoteEntity> = {}): RemoteEntity {
  return {
    id: 'content-1',
    bookId: 'book-1',
    type: 'shortReview',
    text: '初始短評',
    createdAt: firstAt,
    updatedAt: firstAt,
    revision: 1,
    schemaVersion: 1,
    provenance: { kind: 'manual' },
    ...changes
  }
}

class SqliteD1Database implements D1Database {
  constructor(private readonly database: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new SqliteD1Statement(this.database.prepare(query))
  }
}

class SqliteD1Statement implements D1PreparedStatement {
  private values: SQLInputValue[] = []

  constructor(private readonly statement: StatementSync) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values = values.map(toSqliteValue)
    return this
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.statement.get(...this.values) as T | undefined) ?? null
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return {
      results: this.statement.all(...this.values) as unknown as T[],
      success: true,
      meta: {}
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = this.statement.run(...this.values)
    return {
      success: true,
      meta: { changes: Number(result.changes) }
    }
  }
}

function toSqliteValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint') return value
  throw new TypeError('Test D1 adapter only accepts SQLite scalar values')
}
