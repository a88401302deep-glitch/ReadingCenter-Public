import type { DictionaryEntry, SourceReadingDay } from '../../domain'
import type { ReadingTimelineData, TimelineEntry } from './reading-timeline'

export interface ReadingDay {
  date: string
  minutes: number
  knownRecords: number
  unknownRecords: number
  entries: TimelineEntry[]
  reading: boolean
  sourceDays?: SourceReadingDay[]
}
export interface PeriodStatistics {
  minutes: number
  knownRecords: number
  unknownRecords: number
  readingDays: number
  completedBooks: number
  readBooks: number
  days: ReadingDay[]
}
export interface ReadingStatisticsData {
  currentMonth: string
  days: ReadingDay[]
  undatedCompletions: number
  categoryNames: Record<string, string>
}
export const readingDateKey = (value: string, timeZone = 'Asia/Taipei'): string => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Use the same start-date attribution as homepage metrics; never create sessions from completions. */
export function buildReadingStatistics(timeline: ReadingTimelineData, dictionaries: DictionaryEntry[], currentMonth: string, timeZone = 'Asia/Taipei', sourceDays: SourceReadingDay[] = []): ReadingStatisticsData {
  const days = new Map<string, ReadingDay>()
  const day = (date: string) => {
    if (!days.has(date)) days.set(date, { date, minutes: 0, knownRecords: 0, unknownRecords: 0, entries: [], reading: false })
    return days.get(date)!
  }
  for (const entry of timeline.entries) {
    const first = day(readingDateKey(entry.date, timeZone))
    first.entries.push(entry)
    if (entry.kind !== 'record') continue
    first.reading = true
    if (entry.durationMinutes === null) first.unknownRecords++
    else { first.minutes += entry.durationMinutes; first.knownRecords++ }
    const start = Date.parse(entry.record.startedAt)
    const declaredEnd = entry.record.endedAt ? Date.parse(entry.record.endedAt) : start + (entry.durationMinutes ?? 0) * 60_000
    const end = declaredEnd > start ? declaredEnd - 1 : start
    const dates = new Set([readingDateKey(new Date(start).toISOString(), timeZone), readingDateKey(new Date(end).toISOString(), timeZone)])
    for (let cursor = start + 6 * 60 * 60_000; cursor < end; cursor += 6 * 60 * 60_000) dates.add(readingDateKey(new Date(cursor).toISOString(), timeZone))
    for (const date of dates) {
      const target = day(date)
      target.reading = true
      if (target !== first) target.entries.push(entry)
    }
  }
  for (const row of sourceDays) { const target = day(row.date); target.reading = true; target.minutes += row.durationMs / 60000; target.knownRecords++; (target.sourceDays ??= []).push(row) }
  return { currentMonth, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)), undatedCompletions: timeline.undatedCompletions, categoryNames: Object.fromEntries(dictionaries.filter(item => item.kind === 'category').map(item => [item.id, item.name])) }
}

export function statisticsForPeriod(data: ReadingStatisticsData, prefix: string): PeriodStatistics {
  const days = data.days.filter(day => day.date.startsWith(prefix))
  const entries = days.flatMap(day => day.entries)
  return {
    minutes: days.reduce((sum, day) => sum + day.minutes, 0),
    knownRecords: days.reduce((sum, day) => sum + day.knownRecords, 0),
    unknownRecords: days.reduce((sum, day) => sum + day.unknownRecords, 0),
    readingDays: days.filter(day => day.reading).length,
    completedBooks: new Set(entries.filter(entry => (entry.kind === 'completion' || entry.kind === 'source-completion')).map(entry => entry.book.id)).size,
    readBooks: new Set([...entries.map(entry => entry.book.id), ...days.flatMap(day => (day.sourceDays ?? []).flatMap(row => row.bookId ? [row.bookId] : []))]).size,
    days
  }
}

export function categoryStatistics(data: ReadingStatisticsData, period: PeriodStatistics) {
  const books = new Map(period.days.flatMap(day => day.entries).map(entry => [entry.book.id, entry.book]))
  const categories = new Map<string, number>()
  for (const book of books.values()) for (const id of new Set(book.categoryIds.length ? book.categoryIds : ['uncategorized'])) categories.set(id, (categories.get(id) ?? 0) + 1)
  return [...categories].map(([id, count]) => ({ id, name: id === 'uncategorized' ? '未分類' : data.categoryNames[id] ?? '分類名稱未設定', count, percentage: books.size ? Math.round(count / books.size * 100) : 0 })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}


