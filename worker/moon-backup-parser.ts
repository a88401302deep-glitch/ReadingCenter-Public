import initSqlJs from 'sql.js/dist/sql-asm.js'
import type { Database } from 'sql.js'
import { openBinaryZip } from '../src/import/notion-zip-reader'
import { parseMoonDays, type MoonStatistic } from '../src/import/moon-statistics'
import { findMoonCoverCandidates } from '../src/import/moon-cover-candidates'

export interface MoonBackupBook {
  title: string
  author: string
  path: string
  coverPath: string | null
  coverCandidates?: string[]
}

export interface ParsedMoonBackup {
  books: MoonBackupBook[]
  statistics: MoonStatistic[]
  unmatchedStatistics: MoonStatistic[]
}

type Row = Record<string, unknown>

let sqlPromise: ReturnType<typeof initSqlJs> | undefined
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const isImagePath = (value: string): boolean =>
  ['.png', '.jpg', '.jpeg', '.webp'].some(extension => value.toLocaleLowerCase().endsWith(extension))

function query(db: Database, sql: string): Row[] {
  return db.exec(sql).flatMap(result =>
    result.values.map(row => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])))
  )
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Moon+ backup contains an invalid statistic')
  }
  return value
}

/** Parses only the book and daily-stat data needed for the automatic sync. */
export async function parseMoonBackup(bytes: Uint8Array): Promise<ParsedMoonBackup> {
  const archive = new Blob([bytes.slice().buffer as ArrayBuffer])
  const zip = await openBinaryZip(archive)
  const manifests = zip.filenames.filter(path => path === '_names.list' || path.endsWith('/_names.list'))
  if (manifests.length !== 1) throw new Error('Moon+ backup must contain exactly one file manifest')
  const manifest = manifests[0]
  const prefix = manifest.slice(0, manifest.lastIndexOf('/') + 1)
  const manifestBytes = await zip.readBinary(manifest, 2 * 1024 * 1024)
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)
    .split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line)
  if (lines.at(-1) === '') lines.pop()

  const paths = new Map<string, string>()
  for (let index = 0; index < lines.length; index++) {
    const sourcePath = lines[index].startsWith('*') ? lines[index].slice(1) : lines[index]
    if (!sourcePath) throw new Error('Moon+ backup manifest contains an empty path')
    const entry = `${prefix}${index + 1}.tag`
    if (!zip.filenames.includes(entry)) throw new Error('Moon+ backup is incomplete')
    const previous = paths.get(sourcePath)
    if (previous) {
      if (!isImagePath(sourcePath)) throw new Error('Moon+ backup manifest repeats a data path')
      const [before, after] = await Promise.all([
        zip.readBinary(previous, 10 * 1024 * 1024),
        zip.readBinary(entry, 10 * 1024 * 1024)
      ])
      if (before.length !== after.length || before.some((byte, at) => byte !== after[at])) {
        throw new Error('Moon+ backup contains conflicting cover files')
      }
    } else paths.set(sourcePath, entry)
  }

  const databases = [...paths].filter(([sourcePath]) => sourcePath.endsWith('/databases/mrbooks.db'))
  if (databases.length !== 1) throw new Error('Moon+ backup must contain exactly one book database')
  const databaseBytes = await zip.readBinary(databases[0][1], 32 * 1024 * 1024)
  const SQL = await (sqlPromise ??= initSqlJs().catch(error => {
    sqlPromise = undefined
    throw error
  }))
  const db = new SQL.Database(databaseBytes)
  try {
    if (db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') {
      throw new Error('Moon+ book database integrity check failed')
    }
    const books = query(db, 'SELECT book, author, filename, coverFile, thumbFile FROM books').map(row => {
      const path = text(row.filename)
      if (!path) throw new Error('Moon+ book is missing its source path')
      const covers = [text(row.coverFile), text(row.thumbFile)].filter(isImagePath)
      const coverPath = covers.find(name => paths.has(name)) ?? null
      const coverCandidates = coverPath ? [] : covers.flatMap(reference => findMoonCoverCandidates(reference, paths.keys()))
      return {
        title: text(row.book) || path.split('/').at(-1) || path,
        author: text(row.author),
        path,
        coverPath,
        coverCandidates: [...new Set(coverCandidates)]
      }
    })
    const statistics = query(db, 'SELECT filename, usedTime, readWords, dates FROM statistics').map(row => {
      const path = text(row.filename)
      if (!path) throw new Error('Moon+ statistic is missing its source path')
      const days = parseMoonDays(text(row.dates))
      const durationMs = count(row.usedTime)
      const readWords = count(row.readWords)
      if (days.reduce((sum, day) => sum + day.durationMs, 0) !== durationMs ||
        days.reduce((sum, day) => sum + day.readWords, 0) !== readWords) {
        throw new Error('Moon+ daily and per-book totals do not match')
      }
      return { path, durationMs, readWords, days }
    })
    const bookPaths = new Set(books.map(book => book.path))
    return { books, statistics, unmatchedStatistics: statistics.filter(statistic => !bookPaths.has(statistic.path)) }
  } finally {
    db.close()
  }
}

