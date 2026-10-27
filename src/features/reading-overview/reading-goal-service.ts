import { assertValidReadingGoal, createMetadata, readingGoalId, updateEntity, type ReadingGoal } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'

export async function saveReadingGoal(repositories: ReadingCenterRepositories, period: string, targetMinutes: number | null, expectedRevision: number, now: string): Promise<ReadingGoal> {
  const id = readingGoalId(period)
  const current = await repositories.readingGoals.getById(id)
  if ((current?.revision ?? 0) !== expectedRevision) throw new Error('目標已有新版本；請取消編輯並核對最新設定後再儲存')
  const goal: ReadingGoal = current ? updateEntity(current, { targetMinutes }, now) : { ...createMetadata({ id, now }), period, targetMinutes }
  assertValidReadingGoal(goal)
  await repositories.readingGoals.save(goal)
  return goal
}

export async function saveAnnualBookGoal(repositories: ReadingCenterRepositories, period: string, targetBooks: number, expectedRevision: number, now: string): Promise<ReadingGoal> {
  const id = readingGoalId(period)
  const current = await repositories.readingGoals.getById(id)
  if ((current?.revision ?? 0) !== expectedRevision) throw new Error('目標已有新版本；請取消編輯並核對最新設定後再儲存')
  const goal: ReadingGoal = current ? updateEntity(current, { targetBooks }, now) : { ...createMetadata({ id, now }), period, targetMinutes: null, targetBooks }
  assertValidReadingGoal(goal)
  await repositories.readingGoals.save(goal)
  return goal
}
