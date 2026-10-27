import initSqlJs from 'sql.js/dist/sql-asm.js'
import type { Database } from 'sql.js'
import { openBinaryZip } from './notion-zip-reader'
import { parseMoonDays, type MoonStatistic } from './moon-statistics'
import { findMoonCoverCandidates } from './moon-cover-candidates'

export interface MoonBook { title: string; author: string; path: string; coverPath: string | null; coverCandidates?: string[] }
export interface MoonBackup {
  books: MoonBook[]
  statistics: MoonStatistic[]
  unmatchedStatistics: MoonStatistic[]
  readCover(path: string): Promise<Blob>
}
let sqlPromise: ReturnType<typeof initSqlJs> | undefined
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const count = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('備份統計含有無效數值')
  return value
}
function query(db: Database, sql: string): Record<string, unknown>[] {
  return db.exec(sql).flatMap(result => result.values.map(row => Object.fromEntries(result.columns.map((column, i) => [column, row[i]]))))
}
export async function openMoonBackup(file: Blob): Promise<MoonBackup> {
  const zip = await openBinaryZip(file)
  const manifests = zip.filenames.filter(path => /(^|\/)_names\.list$/.test(path))
  if (manifests.length !== 1) throw new Error('找不到唯一的靜讀天下備份清單')
  const manifest = manifests[0]
  const prefix = manifest.slice(0, manifest.lastIndexOf('/') + 1)
  const lines = new TextDecoder('utf-8', { fatal: true }).decode(await zip.readBinary(manifest, 2 * 1024 * 1024)).split(/\r?\n/)
  if (lines.at(-1) === '') lines.pop()
  const paths = new Map<string, string>()
  for (let i = 0; i < lines.length; i++) {
    const original = lines[i].replace(/^\*/, '')
    if (!original) throw new Error('備份清單含空白路徑')
    const entry = `${prefix}${i + 1}.tag`
    if (!zip.filenames.includes(entry)) throw new Error('備份內容不完整')
    const previous = paths.get(original)
    if (previous) {
      if (!/\.(png|jpe?g|webp)$/i.test(original)) throw new Error('備份清單含重複資料路徑')
      const [before, after] = await Promise.all([zip.readBinary(previous, 10 * 1024 * 1024), zip.readBinary(entry, 10 * 1024 * 1024)])
      if (before.length !== after.length || before.some((byte, index) => byte !== after[index])) throw new Error('同一路徑有不同封面，需要核對')
    } else paths.set(original, entry)
  }
  const databases = [...paths].filter(([path]) => path.endsWith('/databases/mrbooks.db'))
  if (databases.length !== 1) throw new Error('找不到唯一的書籍資料庫')
  const bytes = await zip.readBinary(databases[0][1], 32 * 1024 * 1024)
  const SQL = await (sqlPromise ??= initSqlJs().catch(error => { sqlPromise = undefined; throw error }))
  const db = new SQL.Database(bytes)
  try {
    if (db.exec('PRAGMA integrity_check')[0]?.values[0]?.[0] !== 'ok') throw new Error('書籍資料庫完整性檢查失敗')
    const books = query(db, 'SELECT book, author, filename, coverFile, thumbFile FROM books').map(row => {
      const path = text(row.filename)
      if (!path) throw new Error('書籍缺少來源路徑')
      const covers = [text(row.coverFile), text(row.thumbFile)].filter(path => /\.(png|jpe?g|webp)$/i.test(path))
      const coverPath = covers.find(path => paths.has(path)) ?? null
      const coverCandidates = coverPath ? [] : covers.flatMap(reference => findMoonCoverCandidates(reference, paths.keys()))
      return { title: text(row.book) || path.split('/').at(-1) || path, author: text(row.author), path, coverPath, coverCandidates: [...new Set(coverCandidates)] }
    })
    const statistics = query(db, 'SELECT filename, usedTime, readWords, dates FROM statistics').map(row => {
      const path = text(row.filename)
      if (!path) throw new Error('統計缺少來源路徑')
      const days = parseMoonDays(text(row.dates))
      const durationMs = count(row.usedTime), readWords = count(row.readWords)
      if (days.reduce((sum, day) => sum + day.durationMs, 0) !== durationMs || days.reduce((sum, day) => sum + day.readWords, 0) !== readWords) throw new Error('逐書累計與每日明細不一致，需要核對')
      return { path, durationMs, readWords, days }
    })
    const bookPaths = new Set(books.map(book => book.path))
    return {
      books, statistics, unmatchedStatistics: statistics.filter(statistic => !bookPaths.has(statistic.path)),
      async readCover(path: string) {
        const entry = paths.get(path)
        if (!entry || !/\.(png|jpe?g|webp)$/i.test(path)) throw new Error('找不到封面圖片')
        const bytes = await zip.readBinary(entry, 10 * 1024 * 1024)
        const blob = new Blob([new Uint8Array(bytes)], { type: /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg' })
        const bitmap = await createImageBitmap(blob)
        bitmap.close()
        return blob
      }
    }
  } finally { db.close() }
}

