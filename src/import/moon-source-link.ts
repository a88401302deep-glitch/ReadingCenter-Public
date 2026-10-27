import type { ReadingCenterRepositories } from '../data'
import { assertValidSourceReadingDay, updateEntity, type SourceReadingDay } from '../domain'

/** Link an explicitly reviewed device/path group, preserving source evidence. */
export async function linkMoonSourceGroup(repositories: ReadingCenterRepositories, reviewed: readonly SourceReadingDay[], bookId: string | null, now = new Date().toISOString()) {
  if (!reviewed.length) throw new Error('沒有可配對的來源紀錄')
  const { deviceId, sourcePath } = reviewed[0]
  if (reviewed.some(row => row.deviceId !== deviceId || row.sourcePath !== sourcePath) || new Set(reviewed.map(row => row.id)).size !== reviewed.length) throw new Error('來源群組不一致')
  const persist = async () => {
    if (bookId !== null && !(await repositories.books.getById(bookId))) throw new Error('正式書籍不存在，請重新核對')
    const current = (await repositories.sourceReadingDays.getAll()).filter(row => row.deviceId === deviceId && row.sourcePath === sourcePath)
    const versions = new Map(reviewed.map(row => [row.id, row.revision]))
    if (current.length !== reviewed.length || current.some(row => versions.get(row.id) !== row.revision)) throw new Error('來源資料已有新版本，請重新載入後核對')
    const changed = current.filter(row => row.bookId !== bookId).map(row => updateEntity(row, { bookId }, now))
    changed.forEach(assertValidSourceReadingDay)
    for (const row of changed) await repositories.sourceReadingDays.save(row)
    return changed.length
  }
  return repositories.transaction ? repositories.transaction(persist) : persist()
}
