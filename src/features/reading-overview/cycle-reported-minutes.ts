import type { ReadingCycle, ReadingRecord, SourceReadingDay } from '../../domain'

/** Undated fallback only. Explicit manual sessions add to the reported total.
 * Imported timed records replace their own cycle total, never another cycle's.
 * Unassigned or unresolved duration and daily sources have no confirmed cycle scope,
 * so retain the conservative whole-book suppression for those cases.
 */
export function cycleReportedMinutes(cycles: readonly ReadingCycle[], records: readonly ReadingRecord[], sourceDays: readonly SourceReadingDay[]): Map<string, number> {
  const cyclesById = new Map(cycles.map(cycle => [cycle.id, cycle]))
  const ambiguousBooks = new Set(sourceDays.flatMap(row => row.bookId ? [row.bookId] : []))
  const detailedCycles = new Set<string>()
  for (const record of records) {
    if (record.durationMinutes === null && record.endedAt === null) continue
    // Manual input is an additional session, not another copy of a source total.
    // Source/device-linked records stay conservative even with manual provenance.
    if (record.provenance.kind === 'manual' && record.sourceId === null && record.deviceId === null) continue
    const cycle = record.cycleId ? cyclesById.get(record.cycleId) : undefined
    if (cycle && cycle.bookId === record.bookId) detailedCycles.add(cycle.id)
    else ambiguousBooks.add(record.bookId)
  }
  const result = new Map<string, number>()
  for (const cycle of cycles) {
    if (cycle.reportedDurationMinutes == null || ambiguousBooks.has(cycle.bookId) || detailedCycles.has(cycle.id)) continue
    result.set(cycle.bookId, (result.get(cycle.bookId) ?? 0) + cycle.reportedDurationMinutes)
  }
  return result
}
