import type { ReadingCycle, ReadingRecord, SourceReadingDay } from '../../domain'

export const SOURCE_READING_MINIMUM_MS = 5 * 60_000

/** Keep raw imports intact; only linked, meaningful reading enters reading views. */
export function qualifiedSourceBookIds(rows: readonly SourceReadingDay[], cycles: readonly ReadingCycle[] = [], records: readonly ReadingRecord[] = []): Set<string> {
  const totals = new Map<string, number>()
  for (const row of rows) if (row.bookId) totals.set(row.bookId, (totals.get(row.bookId) ?? 0) + row.durationMs)
  const explicit = new Set([...cycles.filter(cycle => cycle.status !== 'planned').map(cycle => cycle.bookId), ...records.map(record => record.bookId)])
  return new Set([...totals].filter(([id, ms]) => ms > SOURCE_READING_MINIMUM_MS || explicit.has(id)).map(([id]) => id))
}
