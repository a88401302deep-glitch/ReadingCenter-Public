import { assertIsoDateTime, type EntityId, type EntityMetadata } from './common'
import { assertValidProgress, type ReadingProgress } from './progress'

export type ActivityType = 'read' | 'watch'

export type ActivityProgress =
  | ReadingProgress
  | {
      unit: 'episode'
      value: number
      total: number | null
      season: number | null
      label: string | null
    }

export interface ActivityLog extends EntityMetadata {
  workId: EntityId
  cycleId: EntityId | null
  activityType: ActivityType
  startedAt: string
  endedAt: string | null
  durationMinutes: number | null
  progressBefore: ActivityProgress | null
  progressAfter: ActivityProgress | null
  deviceId: EntityId | null
  sourceId: EntityId | null
  note: string
}

export function assertValidActivityLog(activity: ActivityLog): void {
  if (!activity.workId.trim()) throw new Error('ActivityLog workId must not be empty')
  assertIsoDateTime(activity.startedAt, 'ActivityLog startedAt')
  if (activity.endedAt !== null) assertIsoDateTime(activity.endedAt, 'ActivityLog endedAt')
  if (activity.endedAt !== null && activity.endedAt < activity.startedAt) {
    throw new Error('ActivityLog endedAt must not precede startedAt')
  }
  if (
    activity.durationMinutes !== null &&
    (!Number.isInteger(activity.durationMinutes) || activity.durationMinutes < 0)
  ) {
    throw new Error('ActivityLog durationMinutes must be a non-negative integer or null')
  }

  assertValidActivityProgress(activity.progressBefore)
  assertValidActivityProgress(activity.progressAfter)
}

export function assertValidActivityProgress(progress: ActivityProgress | null): void {
  if (progress === null) return

  if (progress.unit !== 'episode') {
    assertValidProgress(progress)
    return
  }

  if (!Number.isFinite(progress.value) || progress.value < 0) {
    throw new Error('Episode progress value must be a non-negative finite number')
  }
  if (progress.total !== null) {
    if (!Number.isFinite(progress.total) || progress.total <= 0) {
      throw new Error('Episode progress total must be a positive finite number')
    }
    if (progress.value > progress.total) {
      throw new Error('Episode progress value must not exceed total')
    }
  }
  if (progress.season !== null && (!Number.isInteger(progress.season) || progress.season < 0)) {
    throw new Error('Episode progress season must be a non-negative integer or null')
  }
}
