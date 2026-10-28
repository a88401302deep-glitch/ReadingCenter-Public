import type { ReadingCycle } from '../../domain'

/** Keep date-only evidence intact; import/edit timestamps are never reading dates. */
export function cycleReadingEvidence(cycle: ReadingCycle): string[] {
  const completion = cycle.completionDate
  const completionTime = completion?.precision === 'minute'
    ? new Date(new Date(`${completion.completedOn}T${completion.localTime}:00Z`).getTime() - completion.offsetMinutes * 60_000).toISOString()
    : completion?.completedOn
  return [cycle.startedAt, cycle.finishedAt, cycle.startedOn, cycle.lastReadOn, completionTime]
    .filter((value): value is string => Boolean(value))
}
