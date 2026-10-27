import { assertIsoDateTime, type EntityId, type EntityMetadata, type IsoDateTime } from './common'

export type ReadingCycleStatus = 'planned' | 'reading' | 'paused' | 'completed' | 'abandoned'

/** Keeps source date precision without fabricating a time of day. */
export type ReadingCompletionDate =
  | { precision: 'date'; completedOn: string }
  | { precision: 'minute'; completedOn: string; localTime: string; offsetMinutes: number }
  | { precision: 'range'; startedOn: string; completedOn: string }

export interface ReadingCycle extends EntityMetadata {
  bookId: EntityId
  sequence: number
  status: ReadingCycleStatus
  startedAt: IsoDateTime | null
  finishedAt: IsoDateTime | null
  completionDate?: ReadingCompletionDate | null
  /** Source-reported days spent reading this cycle; never inferred from a date range or converted to hours. */
  reportedReadingDays?: number | null
  /** Whole-cycle source total; never attributed to the completion day. */
  reportedDurationMinutes?: number | null
  abandonedReason: string | null
}

export function assertValidReadingCycle(cycle: ReadingCycle): void {
  if (!cycle.bookId.trim()) throw new Error('ReadingCycle bookId must not be empty')
  if (!Number.isInteger(cycle.sequence) || cycle.sequence < 1) {
    throw new Error('ReadingCycle sequence must be a positive integer')
  }
  if (cycle.startedAt !== null) assertIsoDateTime(cycle.startedAt, 'ReadingCycle startedAt')
  if (cycle.finishedAt !== null) assertIsoDateTime(cycle.finishedAt, 'ReadingCycle finishedAt')
  if (cycle.reportedReadingDays != null && (!Number.isSafeInteger(cycle.reportedReadingDays) || cycle.reportedReadingDays < 1)) {
    throw new Error('ReadingCycle reportedReadingDays must be a positive integer')
  }
  if (cycle.reportedDurationMinutes != null && (!Number.isSafeInteger(cycle.reportedDurationMinutes) || cycle.reportedDurationMinutes < 0)) throw new Error('ReadingCycle reportedDurationMinutes must be a non-negative integer')
  if (cycle.completionDate) {
    if (cycle.status !== 'completed') throw new Error('Only a completed ReadingCycle may have a completion date')
    assertIsoDate(cycle.completionDate.completedOn)
    if (cycle.completionDate.precision === 'range') {
      assertIsoDate(cycle.completionDate.startedOn)
      if (cycle.completionDate.startedOn > cycle.completionDate.completedOn) throw new Error('ReadingCycle completion range is reversed')
    }
    if (cycle.completionDate.precision === 'minute' && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cycle.completionDate.localTime) ||
      !Number.isInteger(cycle.completionDate.offsetMinutes) || Math.abs(cycle.completionDate.offsetMinutes) > 840)) {
      throw new Error('ReadingCycle completion minute or offset is invalid')
    }
  }
  if (cycle.startedAt !== null && cycle.finishedAt !== null && cycle.finishedAt < cycle.startedAt) {
    throw new Error('ReadingCycle finishedAt must not precede startedAt')
  }
  if (cycle.status === 'abandoned' && !cycle.abandonedReason?.trim()) {
    throw new Error('An abandoned ReadingCycle requires a reason')
  }
  if (cycle.status !== 'abandoned' && cycle.abandonedReason !== null) {
    throw new Error('Only an abandoned ReadingCycle may have an abandonedReason')
  }
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('ReadingCycle completion date must be YYYY-MM-DD')
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new Error('ReadingCycle completion date is invalid')
  }
}
