import { describe, expect, it } from 'vitest'
import type { D1PreparedStatement, D1Result } from '../../worker/cloudflare-types'
import { importMoonBackupD1Batch, type AtomicMoonD1Database, type MoonBackupD1Snapshot } from '../../worker/moon-backup-d1-import'

class MemoryStatement implements D1PreparedStatement {
  constructor(
    private readonly database: MemoryD1,
    readonly sql: string,
    readonly values: unknown[] = []
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new MemoryStatement(this.database, this.sql, values)
  }

  async first<T>(): Promise<T | null> {
    return null
  }

  async all<T>(): Promise<D1Result<T>> {
    let rows: Array<Record<string, unknown>> = []
    if (this.sql.includes("entity_kind = 'book'")) {
      rows = [...this.database.entities.values()].filter(row => row.kind === 'book').map(row => ({ payload_json: row.payload }))
    } else if (this.sql.includes("entity_kind = 'dictionary'")) {
      rows = [...this.database.entities.values()].filter(row => row.kind === 'dictionary').map(row => ({ payload_json: row.payload }))
    } else if (this.sql.includes('source_reading_day_entities')) {
      rows = [...this.database.sourceDays.entries()].map(([entity_id, payload_json]) => ({ entity_id, payload_json }))
    }
    return { success: true, results: rows as T[], meta: { changes: 0 } }
  }

  async run<T>(): Promise<D1Result<T>> {
    return { success: true, results: [], meta: { changes: 0 } }
  }
}

class MemoryD1 implements AtomicMoonD1Database {
  readonly entities = new Map<string, { kind: string; payload: string }>()
  readonly sourceDays = new Map<string, string>()

  prepare(query: string): D1PreparedStatement {
    return new MemoryStatement(this, query)
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    return statements.map(statement => {
      const current = statement as MemoryStatement
      let id = ''
      if (current.sql.includes('INSERT INTO entities')) {
        const values = current.values as string[]
        const [kind, entityId, , , , , , payload] = values
        id = entityId
        this.entities.set(kind + ':' + entityId, { kind, payload })
      } else if (current.sql.includes('INSERT INTO source_reading_day_entities')) {
        const values = current.values as string[]
        const [entityId, , , , , , payload] = values
        id = entityId
        this.sourceDays.set(entityId, payload)
      } else if (current.sql.startsWith('UPDATE source_reading_day_entities')) {
        const values = current.values as Array<string | number>
        const payload = String(values[4])
        const entityId = values[6]
        id = String(entityId)
        this.sourceDays.set(id, payload)
      }
      return { success: true, results: [{ entity_id: id }], meta: { changes: 1 } }
    })
  }
}

const now = '2026-10-09T00:00:00.000Z'

function snapshot(durationMs = 6000, readWords = 50, progressPercent = 75): MoonBackupD1Snapshot {
  return {
    deviceId: 'BOOX TUCP',
    name: 'latest.mrpro',
    backup: {
      books: [{ title: '測試小說', author: '測試作者', path: '/books/test.epub', coverPath: null }],
      statistics: [{
        path: '/books/test.epub',
        durationMs,
        readWords,
        days: [{ dayCode: 20733, durationMs, readWords, progressPercent }]
      }]
    }
  }
}

describe('importMoonBackupD1Batch', () => {
  it('creates a book and source day once, then updates changed daily source values without unlinking the book', async () => {
    const database = new MemoryD1()
    const first = await importMoonBackupD1Batch(database, [snapshot()], now)

    expect(first).toMatchObject({
      booksCreated: 1,
      booksMatched: 0,
      booksPending: 0,
      statistics: { imported: 1, updated: 0 }
    })
    const storedDay = JSON.parse([...database.sourceDays.values()][0]) as { id: string; bookId: string | null; revision: number }
    expect(storedDay.bookId).toMatch(/^moon:book:/)
    expect(storedDay.revision).toBe(1)

    const repeated = await importMoonBackupD1Batch(database, [snapshot()], now)
    expect(repeated).toMatchObject({
      booksCreated: 0,
      booksMatched: 1,
      statistics: { imported: 0, updated: 0, skipped: 1 }
    })
    expect(database.entities.size).toBe(2)
    expect(database.sourceDays.size).toBe(1)

    const changed = await importMoonBackupD1Batch(database, [snapshot(12000, 100, 80)], now)
    expect(changed.statistics).toMatchObject({ imported: 0, updated: 1 })
    const updatedDay = JSON.parse(database.sourceDays.get(storedDay.id)!) as typeof storedDay & { durationMs: number; readWords: number }
    expect(updatedDay).toMatchObject({
      id: storedDay.id,
      bookId: storedDay.bookId,
      revision: 2,
      durationMs: 12000,
      readWords: 100
    })
  })
})
