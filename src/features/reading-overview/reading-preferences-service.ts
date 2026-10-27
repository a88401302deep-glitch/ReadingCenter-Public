import { assertValidReadingPreferences, createMetadata, readingPreferencesId, updateEntity, type ReadingPreferences } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'
export async function saveMonthColors(repositories: ReadingCenterRepositories, monthColors: string[], expectedRevision: number, now: string): Promise<ReadingPreferences> {
  const current = await repositories.readingPreferences.getById(readingPreferencesId)
  if ((current?.revision ?? 0) !== expectedRevision) throw new Error('配色已有新版本；請取消編輯並核對最新設定後再儲存')
  const colors = monthColors.map(color => color.toLowerCase())
  const value: ReadingPreferences = current ? updateEntity(current, { monthColors: colors }, now) : { ...createMetadata({ id: readingPreferencesId, now }), monthColors: colors }
  assertValidReadingPreferences(value)
  await repositories.readingPreferences.save(value)
  return value
}
