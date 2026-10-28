import { getBookDisplayTitle, type Book, type EntityId, type ReadingProgress, type ReadingRecord, type SourceReadingDay } from '../../domain'
import { libraryBookReadings, type LibraryReadingStatus } from '../library/library-book-summary'
import { cycleProgress } from './cycle-progress'
import { cycleReadingEvidence } from './cycle-reading-evidence'
import { cycleReportedMinutes } from './cycle-reported-minutes'
import { sourceCompletions } from './source-completions'
import { qualifiedSourceBookIds } from '../library/source-reading-scope'
import { buildHomeSummaries, type HomeSummaries } from './home-summaries'
import { buildReadingStatistics, type ReadingStatisticsData } from './reading-statistics'
import { buildReadingTimeline, type ReadingTimelineData } from './reading-timeline'
import { saveMonthColors } from './reading-preferences-service'
import { saveAnnualBookGoal, saveReadingGoal } from './reading-goal-service'
import { readingPreferencesId, type ReadingPreferences, type ReadingGoal } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'

export interface ReadingMetrics {
  bookCount: number
  completedBookCount: number
  readingDays: number
  totalMinutes: number
  recordCount: number
  sourceDayCount?: number
  readWords?: number
}

export interface RecentBook {
  book: Book
  lastReadAt: string
  totalMinutes: number
  progress: ReadingProgress | null
  hasRecordedDuration: boolean
  status?: LibraryReadingStatus
}

export interface ReadingActivity {
  id: EntityId
  bookId: EntityId
  bookTitle: string
  startedAt: string
  durationMinutes: number
  progress: ReadingProgress | null
}

export interface BookWordCountSummary { totalWords: string; knownBooks: number; unknownBooks: number }
export interface ReadingOverview {
  preferences?: ReadingPreferences | null
  goals?: ReadingGoal[]
  statistics?: ReadingStatisticsData
  timeline?: ReadingTimelineData
  summaries?: HomeSummaries
  wordCounts?: { allTime: BookWordCountSummary; month: BookWordCountSummary }
  sourceTotals?: { rows: number; durationMs: number; readWords: number }
  metrics: ReadingMetrics
  recentBooks: RecentBook[]
  activities: ReadingActivity[]
  sourceDaysByBook?: Record<EntityId, SourceReadingDay[]>
  byBook: Record<EntityId, ReadingMetrics>
}

const durationOf = (record: ReadingRecord): number => {
  if (record.durationMinutes !== null) return record.durationMinutes
  if (!record.endedAt) return 0
  return Math.max(0, Math.round((new Date(record.endedAt).getTime() - new Date(record.startedAt).getTime()) / 60_000))
}

export class ReadingOverviewService {
  constructor(
    private readonly repositories: ReadingCenterRepositories,
    private readonly now: () => Date = () => new Date(),
    private readonly timeZone = 'Asia/Taipei'
  ) {}

  private dateKey(value: Date | string): string {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: this.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(value))
    const valueOf = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
    return `${valueOf('year')}-${valueOf('month')}-${valueOf('day')}`
  }

  private recordDays(record: ReadingRecord): string[] {
    const start = new Date(record.startedAt)
    const durationEnd = new Date(start.getTime() + durationOf(record) * 60_000)
    const declaredEnd = record.endedAt ? new Date(record.endedAt) : durationEnd
    const end = declaredEnd.getTime() > start.getTime() ? new Date(declaredEnd.getTime() - 1) : start
    const days = new Set<string>([this.dateKey(start), this.dateKey(end)])
    for (let cursor = start.getTime() + 6 * 60 * 60_000; cursor < end.getTime(); cursor += 6 * 60 * 60_000) days.add(this.dateKey(new Date(cursor)))
    return [...days]
  }

  async getPreferences(): Promise<ReadingPreferences | null> {
    return await this.repositories.readingPreferences.getById(readingPreferencesId) ?? null
  }

  async saveColors(colors: string[], expectedRevision: number): Promise<ReadingPreferences> {
    return saveMonthColors(this.repositories, colors, expectedRevision, this.now().toISOString())
  }

  async saveGoal(period: string, targetMinutes: number | null, expectedRevision: number): Promise<ReadingGoal> {
    return saveReadingGoal(this.repositories, period, targetMinutes, expectedRevision, this.now().toISOString())
  }

  async saveBookGoal(year: string, targetBooks: number, expectedRevision: number): Promise<ReadingGoal> {
    return saveAnnualBookGoal(this.repositories, year, targetBooks, expectedRevision, this.now().toISOString())
  }

  async getOverview(): Promise<ReadingOverview> {
    const [books, cycles, records, contents, dictionaries, goals, preferences, sourceDays] = await Promise.all([
      this.repositories.books.getAll(),
      this.repositories.readingCycles.getAll(),
      this.repositories.readingRecords.getAll(),
      this.repositories.readingContents.getAll(),
      this.repositories.dictionaries.getAll(),
      this.repositories.readingGoals.getAll(),
      this.repositories.readingPreferences.getById(readingPreferencesId),
      this.repositories.sourceReadingDays.getAll()
    ])
    const reportedMinutes = cycleReportedMinutes(cycles, records, sourceDays)
    const qualifiedIds = qualifiedSourceBookIds(sourceDays, cycles, records)
    const unmatchedTotals = new Map<string, number>()
    const sourceKey = (row: SourceReadingDay) => JSON.stringify([row.deviceId, row.sourcePath])
    for (const row of sourceDays) if (!row.bookId) unmatchedTotals.set(sourceKey(row), (unmatchedTotals.get(sourceKey(row)) ?? 0) + row.durationMs)
    const visibleSourceDays = sourceDays.filter(row => row.bookId ? qualifiedIds.has(row.bookId) : (unmatchedTotals.get(sourceKey(row)) ?? 0) > 5 * 60_000)
    const sourceCompleted = sourceCompletions(visibleSourceDays, cycles)
    const sourceCompletedIds = new Set(sourceCompleted.map(row => row.bookId!))
    const booksById = new Map(books.map((book) => [book.id, book]))
    const monthPrefix = this.dateKey(this.now()).slice(0, 7)
    const monthRecords = records.filter((record) => this.dateKey(record.startedAt).startsWith(monthPrefix))
    const readingDays = new Set(records.flatMap((record) => this.recordDays(record)).filter((day) => day.startsWith(monthPrefix)))
    for (const row of visibleSourceDays) if (row.date.startsWith(monthPrefix)) readingDays.add(row.date)
    const completedBookIds = new Set(cycles.filter((cycle) => {
      if (cycle.status !== 'completed') return false
      // Use confirmed completion evidence; editing a book is never a completion date.
      const completedOn = cycle.completionDate?.completedOn ?? (cycle.finishedAt ? this.dateKey(cycle.finishedAt) : null)
      return completedOn?.startsWith(monthPrefix) ?? false
    }).map((cycle) => cycle.bookId))
    for (const row of sourceCompleted) if (row.date.startsWith(monthPrefix) && booksById.has(row.bookId!)) completedBookIds.add(row.bookId!)
    const sortedRecords = [...records].sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    // Date-only evidence stays a date. On the same day, timed evidence sorts first;
    // never invent midnight or use import/update timestamps as reading evidence.
    const compareEvidence = (a: string, b: string): number => {
      const dateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
      const dayA = dateOnly(a) ? a : this.dateKey(a)
      const dayB = dateOnly(b) ? b : this.dateKey(b)
      return dayB.localeCompare(dayA) || (dateOnly(a) !== dateOnly(b) ? (dateOnly(a) ? 1 : -1) : dateOnly(a) ? 0 : new Date(b).getTime() - new Date(a).getTime())
    }
    const recentMap = new Map<EntityId, RecentBook>()
    for (const record of sortedRecords) {
      const book = booksById.get(record.bookId)
      if (!book) continue
      const existing = recentMap.get(book.id)
      const hasRecordedDuration = record.durationMinutes !== null || record.endedAt !== null
      if (existing) { existing.totalMinutes += durationOf(record); existing.hasRecordedDuration ||= hasRecordedDuration }
      else recentMap.set(book.id, { book, lastReadAt: record.startedAt, totalMinutes: durationOf(record), progress: record.progress, hasRecordedDuration })
    }
    for (const cycle of cycles) {
      const book = booksById.get(cycle.bookId)
      if (!book || cycle.status === 'planned') continue
      const evidence = cycleReadingEvidence(cycle).sort(compareEvidence)[0]
      if (!evidence) continue
      const existing = recentMap.get(book.id)
      const snapshot = cycleProgress(cycle, records, this.timeZone)
      if (existing && snapshot && cycle.lastReadOn && compareEvidence(cycle.lastReadOn, existing.lastReadAt) < 0) existing.progress = snapshot
      if (!existing) recentMap.set(book.id, { book, lastReadAt: evidence, totalMinutes: reportedMinutes.get(book.id) ?? 0, progress: snapshot, hasRecordedDuration: reportedMinutes.has(book.id) })
      else if (compareEvidence(evidence, existing.lastReadAt) < 0) existing.lastReadAt = evidence
    }
    const sourceDaysByBook: Record<EntityId, SourceReadingDay[]> = {}
    for (const row of [...sourceDays].sort((a, b) => b.date.localeCompare(a.date) || b.progressPercent - a.progressPercent || a.id.localeCompare(b.id))) {
      const book = row.bookId ? booksById.get(row.bookId) : undefined
      if (!book) continue
      ;(sourceDaysByBook[book.id] ??= []).push(row)
      if (!qualifiedIds.has(book.id)) continue
      const existing = recentMap.get(book.id)
      if (!existing) recentMap.set(book.id, { book, lastReadAt: row.date, totalMinutes: row.durationMs / 60000, progress: { unit: 'percent', value: row.progressPercent }, hasRecordedDuration: true })
      else {
        existing.totalMinutes += row.durationMs / 60000
        existing.hasRecordedDuration = true
        if (compareEvidence(row.date, existing.lastReadAt) < 0) {
          existing.lastReadAt = row.date
          existing.progress = { unit: 'percent', value: row.progressPercent }
        }
      }
    }
    const byBook: Record<EntityId, ReadingMetrics> = {}
    for (const book of books) {
      const bookRecords = records.filter((record) => record.bookId === book.id)
      const rawBookSourceDays = sourceDaysByBook[book.id] ?? []
      const bookSourceDays = qualifiedIds.has(book.id) ? rawBookSourceDays : []
      byBook[book.id] = {
        bookCount: 1,
        completedBookCount: cycles.some((cycle) => cycle.bookId === book.id && cycle.status === 'completed') || sourceCompletedIds.has(book.id) ? 1 : 0,
        readingDays: new Set([...bookRecords.flatMap((record) => this.recordDays(record)), ...bookSourceDays.map(row => row.date)]).size,
        totalMinutes: bookRecords.reduce((sum, record) => sum + durationOf(record), 0) + bookSourceDays.reduce((sum, row) => sum + row.durationMs / 60000, 0) + (reportedMinutes.get(book.id) ?? 0),
        sourceDayCount: rawBookSourceDays.length,
        readWords: bookSourceDays.reduce((sum, row) => sum + row.readWords, 0),
        recordCount: bookRecords.length + bookSourceDays.length
      }
    }
    // Match the book summary: detailed minutes plus only unrelated cycle fallbacks.
    for (const [id, recent] of recentMap) {
      recent.totalMinutes = byBook[id].totalMinutes
      recent.hasRecordedDuration ||= reportedMinutes.has(id)
    }
    const summarizeWords = (ids: Set<string>): BookWordCountSummary => {
      let total = 0n, knownBooks = 0, unknownBooks = 0
      for (const id of ids) {
        const book = booksById.get(id)
        if (!book) continue
        if (book.wordCount != null && Number.isSafeInteger(book.wordCount) && book.wordCount > 0) { total += BigInt(book.wordCount); knownBooks++ }
        else unknownBooks++
      }
      return { totalWords: total.toString(), knownBooks, unknownBooks }
    }
    const recentBooks = [...recentMap.values()].sort((a, b) => compareEvidence(a.lastReadAt, b.lastReadAt) || a.book.id.localeCompare(b.book.id))
    const readings = libraryBookReadings(books, cycles, records, sourceDays)
    for (const recent of recentBooks) {
      recent.status = readings.get(recent.book.id)?.status
      if (recent.status === 'completed') recent.progress = { unit: 'percent', value: 100 }
    }
    const timeline = buildReadingTimeline(books, cycles, records, compareEvidence, durationOf, visibleSourceDays)
    return {
      sourceDaysByBook,
      sourceTotals: { rows: sourceDays.length, durationMs: sourceDays.reduce((sum, row) => sum + row.durationMs, 0), readWords: sourceDays.reduce((sum, row) => sum + row.readWords, 0) },
      preferences: preferences ?? null,
      goals,
      statistics: buildReadingStatistics(timeline, dictionaries, monthPrefix, this.timeZone, visibleSourceDays),
      timeline,
      summaries: buildHomeSummaries(books, cycles, contents, dictionaries, recentBooks, compareEvidence, sourceCompleted),
      wordCounts: { allTime: summarizeWords(new Set([...cycles.filter(cycle => cycle.status === 'completed').map(cycle => cycle.bookId), ...sourceCompletedIds])), month: summarizeWords(completedBookIds) },
      metrics: {
        bookCount: books.length,
        completedBookCount: completedBookIds.size,
        readingDays: readingDays.size,
        totalMinutes: monthRecords.reduce((sum, record) => sum + durationOf(record), 0) + visibleSourceDays.filter(row => row.date.startsWith(monthPrefix)).reduce((sum, row) => sum + row.durationMs / 60000, 0),
        recordCount: monthRecords.length + visibleSourceDays.filter(row => row.date.startsWith(monthPrefix)).length
      },
      recentBooks,
      activities: sortedRecords.filter((record) => booksById.has(record.bookId)).map((record) => ({
        id: record.id,
        bookId: record.bookId,
        bookTitle: getBookDisplayTitle(booksById.get(record.bookId)!),
        startedAt: record.startedAt,
        durationMinutes: durationOf(record),
        progress: record.progress
      })),
      byBook
    }
  }
}


