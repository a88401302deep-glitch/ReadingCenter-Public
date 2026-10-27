import type { ReadingCycle, ReadingRecord, SourceReadingDay } from '../../domain'

/** Whole-book screenshot totals have no daily distribution. Detailed evidence wins to avoid double counting. */
export function cycleReportedMinutes(cycles: readonly ReadingCycle[], records: readonly ReadingRecord[], sourceDays: readonly SourceReadingDay[]): Map<string, number> {
 const detailed = new Set([...records.map(record => record.bookId), ...sourceDays.flatMap(row => row.bookId ? [row.bookId] : [])])
 const result = new Map<string, number>()
 for (const cycle of cycles) {
  if (cycle.reportedDurationMinutes == null || detailed.has(cycle.bookId)) continue
  result.set(cycle.bookId, (result.get(cycle.bookId) ?? 0) + cycle.reportedDurationMinutes)
 }
 return result
}
