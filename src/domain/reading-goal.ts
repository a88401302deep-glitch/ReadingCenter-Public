import type { EntityMetadata } from './common'

export interface ReadingGoal extends EntityMetadata {
  period: string
  targetMinutes: number | null
  targetBooks?: number
}

export function readingGoalId(period: string): string {
  if (!/^[1-9]\d{3}(?:-(?:0[1-9]|1[0-2]))?$/.test(period)) throw new Error('目標期間無效')
  return `reading-goal:${period}`
}

export function assertValidReadingGoal(goal: ReadingGoal): void {
  if (goal.id !== readingGoalId(goal.period)) throw new Error('目標期間與識別碼不符')
  if (goal.provenance.kind !== 'manual') throw new Error('目標必須由使用者設定')
  if (goal.targetBooks !== undefined && (!/^[1-9]\d{3}$/.test(goal.period) || !Number.isSafeInteger(goal.targetBooks) || goal.targetBooks <= 0)) throw new Error('年度目標必須是大於零的整數本數')
  if (goal.targetMinutes !== null && (!Number.isSafeInteger(goal.targetMinutes) || goal.targetMinutes <= 0)) throw new Error('目標時數必須大於零，且精確至分鐘')
}
