import type { ReadingCycle, SourceReadingDay } from '../../domain'

/** One source completion per book. Confirmed cycles take precedence; repeated 100% rows are not rereads. */
export function sourceCompletions(rows: readonly SourceReadingDay[], cycles: readonly ReadingCycle[]): SourceReadingDay[] {
  const confirmed = new Set(cycles.filter(cycle => cycle.status === 'completed').map(cycle => cycle.bookId))
  const first = new Map<string, SourceReadingDay>()
  for (const row of rows) {
    if (!row.bookId || confirmed.has(row.bookId) || row.progressPercent !== 100 || row.completionDisputed) continue
    const previous = first.get(row.bookId)
    if (!previous || row.date < previous.date || row.date === previous.date && row.id < previous.id) first.set(row.bookId, row)
  }
  return [...first.values()]
}
