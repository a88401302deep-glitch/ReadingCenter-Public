import type { Book, ReadingCycle, ReadingRecord, SourceReadingDay } from '../../domain'
import { sourceCompletions } from './source-completions'
import { completionEvidence } from './home-summaries'

export type TimelineEntry =
  | { id: string; kind: 'record'; book: Book; date: string; record: ReadingRecord; durationMinutes: number | null }
  | { id: string; kind: 'source'; book: Book; date: string; sourceDay: SourceReadingDay; durationMinutes: number }
  | { id: string; kind: 'source-completion'; book: Book; date: string; sourceDay: SourceReadingDay }
  | { id: string; kind: 'completion'; book: Book; date: string; cycle: ReadingCycle }
export interface ReadingTimelineData { entries: TimelineEntry[]; undatedCompletions: number }

export function buildReadingTimeline(books: Book[], cycles: ReadingCycle[], records: ReadingRecord[], compare: (a: string, b: string) => number, duration: (record: ReadingRecord) => number, sourceDays: SourceReadingDay[] = []): ReadingTimelineData {
  const byId = new Map(books.map(book => [book.id, book]))
  const entries: TimelineEntry[] = []
  let undatedCompletions = 0
  for (const record of records) {
    const book = byId.get(record.bookId)
    if (book) entries.push({ id: `record:${record.id}`, kind: 'record', book, date: record.startedAt, record, durationMinutes: record.durationMinutes !== null || record.endedAt !== null ? duration(record) : null })
  }
  for (const row of sourceDays) {
    const book = row.bookId ? byId.get(row.bookId) : undefined
    if (book) entries.push({ id: `source:${row.id}`, kind: 'source', book, date: row.date, sourceDay: row, durationMinutes: row.durationMs / 60000 })
  }
  for (const cycle of cycles) {
    const book = byId.get(cycle.bookId)
    if (!book || cycle.status !== 'completed') continue
    const date = completionEvidence(cycle)
    if (!date) { undatedCompletions++; continue }
    entries.push({ id: `completion:${cycle.id}`, kind: 'completion', book, date, cycle })
  }
  for (const row of sourceCompletions(sourceDays, cycles)) {
    const book = row.bookId ? byId.get(row.bookId) : undefined
    if (book) entries.push({ id: `source-completion:${book.id}`, kind: 'source-completion', book, date: row.date, sourceDay: row })
  }
  return { entries: entries.sort((a, b) => compare(a.date, b.date) || a.id.localeCompare(b.id)), undatedCompletions }
}

