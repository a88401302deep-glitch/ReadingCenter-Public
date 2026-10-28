import type { ReadingCycle, ReadingProgress, ReadingRecord } from '../../domain'

/** A dated snapshot never replaces a newer (or same-day timed) manual progress record. */
export function cycleProgress(cycle: ReadingCycle, records: readonly ReadingRecord[], timeZone = 'Asia/Taipei'): ReadingProgress | null {
  const record = records.filter(row => row.bookId === cycle.bookId && row.cycleId === cycle.id && row.progress)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0]
  const snapshot: ReadingProgress | null = cycle.reportedProgressPercent == null ? null : { unit: 'percent', value: cycle.reportedProgressPercent }
  if (!record) return snapshot
  if (snapshot && cycle.lastReadOn) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(record.startedAt))
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? ''
    if (`${value('year')}-${value('month')}-${value('day')}` < cycle.lastReadOn) return snapshot
  }
  return record.progress
}
