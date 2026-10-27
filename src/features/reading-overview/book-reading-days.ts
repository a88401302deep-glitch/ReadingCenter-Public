import type { ReadingProgress } from '../../domain'
import type { ReadingOverview } from './reading-overview-service'
import { readingDateKey } from './reading-statistics'

export interface BookReadingDay {
  date: string
  minutes: number | null
  words: number | null
  progress: ReadingProgress | null
  completed: boolean
}

/** A derived view only: source rows stay intact for reimport, matching and recalculation. */
export function bookReadingDays(overview: ReadingOverview, bookId: string): BookReadingDay[] {
  const days = new Map<string, BookReadingDay>()
  const seen = new Set<string>()
  const timedProgress = new Set<string>()
  for (const entry of overview.timeline?.entries ?? []) {
    if (entry.book.id !== bookId || seen.has(entry.id)) continue
    seen.add(entry.id)
    const date = readingDateKey(entry.date)
    const day = days.get(date) ?? { date, minutes: null, words: null, progress: null, completed: false }
    days.set(date, day)
    if (entry.kind === 'record' || entry.kind === 'source') {
      if (entry.durationMinutes !== null) day.minutes = (day.minutes ?? 0) + entry.durationMinutes
      const progress = entry.kind === 'source' ? { unit: 'percent' as const, value: entry.sourceDay.progressPercent } : entry.record.progress
      // Timed evidence sorts before date-only sources. Sources on one day have no
      // time ordering: keep the highest percentage, matching the overview policy.
      if (entry.kind === 'record' && progress && !timedProgress.has(date)) { day.progress = progress; timedProgress.add(date) }
      else if (entry.kind === 'source' && !timedProgress.has(date) && (!day.progress || progress!.value > day.progress.value)) day.progress = progress
      if (entry.kind === 'source') day.words = (day.words ?? 0) + entry.sourceDay.readWords
    } else day.completed = true
  }
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export function readingProgressLabel(progress: ReadingProgress | null | undefined) {
  if (!progress) return '未記錄'
  return `${progress.value}${progress.unit === 'percent' ? '%' : progress.unit === 'page' ? ' 頁' : ' 章'}`
}

