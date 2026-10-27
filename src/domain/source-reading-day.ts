import { assertIsoDateTime, type EntityMetadata } from './common'

/** Daily source totals are not timed sessions or formal completion cycles. */
export interface SourceReadingDay extends EntityMetadata {
  source: 'moon'
  deviceId: string
  sourcePath: string
  sourceTitle: string
  backupName: string
  dayCode: number
  date: string
  durationMs: number
  readWords: number
  progressPercent: number
  bookId: string | null
  completionDisputed: boolean
}

export function sourceDayDate(dayCode: number): string {
  if (!Number.isSafeInteger(dayCode) || dayCode < 0) throw new Error('來源日碼無效')
  const time = (dayCode + 1) * 86400000
  if (!Number.isSafeInteger(time)) throw new Error('來源日碼超出範圍')
  const date = new Date(time)
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() < 1000 || date.getUTCFullYear() > 9999) throw new Error('來源日期超出範圍')
  return date.toISOString().slice(0, 10)
}

export function assertValidSourceReadingDay(day: SourceReadingDay): void {
  for (const value of [day.id, day.deviceId, day.sourcePath, day.sourceTitle, day.backupName]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('來源資訊不完整')
  }
  if (day.source !== 'moon' || day.date !== sourceDayDate(day.dayCode)) throw new Error('來源日期與日碼不一致')
  for (const value of [day.durationMs, day.readWords]) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('來源閱讀量無效')
  }
  if (!Number.isFinite(day.progressPercent) || day.progressPercent < 0 || day.progressPercent > 100) throw new Error('來源進度無效')
  if (day.bookId !== null && (typeof day.bookId !== 'string' || !day.bookId.trim())) throw new Error('書籍配對無效')
  if (typeof day.completionDisputed !== 'boolean') throw new Error('完讀核對標記無效')
  if (!Number.isSafeInteger(day.revision) || day.revision < 1 || day.schemaVersion !== 1) throw new Error('來源版本無效')
  assertIsoDateTime(day.createdAt, 'createdAt'); assertIsoDateTime(day.updatedAt, 'updatedAt')
}
