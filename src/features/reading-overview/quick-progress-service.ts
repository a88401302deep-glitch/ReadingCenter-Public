import { assertValidProgress, type ReadingProgress } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'
import { libraryBookReadings } from '../library/library-book-summary'
import { ReadingRecordService } from '../reading-records/reading-record-service'

export interface QuickProgressContext { progress: ReadingProgress | null; cycleId: string | null; token: string }
const progressKey = (p: ReadingProgress | null) => p ? JSON.stringify([p.unit, p.value, p.unit === 'percent' ? null : p.total, p.unit === 'chapter' || p.unit === 'position' ? p.label : null]) : ''
/** Append a confirmed snapshot without inferring duration or completion. */
export class QuickProgressService {
  constructor(private readonly repositories: ReadingCenterRepositories) {}
  async load(bookId: string): Promise<QuickProgressContext> {
    const [book, allCycles, allRecords, allSources] = await Promise.all([
      this.repositories.books.getById(bookId), this.repositories.readingCycles.getAll(),
      this.repositories.readingRecords.getAll(), this.repositories.sourceReadingDays.getAll()
    ])
    if (!book) throw new Error('找不到這本書，請重新整理')
    const cycles = allCycles.filter(row => row.bookId === bookId)
    const records = allRecords.filter(row => row.bookId === bookId)
    const sources = allSources.filter(row => row.bookId === bookId)
    const reading = libraryBookReadings([book], cycles, records, sources).get(bookId)!
    if (reading.status !== 'reading') throw new Error('這本書目前不是閱讀中，請到單書頁核對狀態')
    const latest = [...cycles].sort((a, b) => b.sequence - a.sequence)[0]
    const versions = (items: { id: string; revision: number }[]) => items.map(row => [row.id, row.revision] as const).sort((a, b) => a[0].localeCompare(b[0]))
    return { progress: reading.progress, cycleId: latest?.status === 'reading' ? latest.id : null, token: JSON.stringify([versions(cycles), versions(records), versions(sources)]) }
  }
  async save(bookId: string, operationId: string, expectedToken: string, startedAt: string, progress: ReadingProgress) {
    const persist = async () => {
      try { assertValidProgress(progress) } catch { throw new Error('進度格式不正確，請核對目前進度與總數') }
      if (!operationId.trim()) throw new Error('缺少儲存識別碼，請重新開啟')
      const existing = await this.repositories.readingRecords.getById(operationId)
      if (existing) {
        if (existing.bookId === bookId && existing.startedAt === startedAt && progressKey(existing.progress) === progressKey(progress) && existing.durationMinutes === null && existing.endedAt === null) return existing
        throw new Error('此儲存識別碼已有不同資料，請重新開啟')
      }
      const context = await this.load(bookId)
      if (context.token !== expectedToken) throw new Error('閱讀資料已有變更；草稿已保留，請重新開啟核對')
      return new ReadingRecordService(this.repositories, () => operationId).create(bookId, { cycleId: context.cycleId, startedAt, progress, endedAt: null, durationMinutes: null, deviceId: null, sourceId: null })
    }
    return this.repositories.transaction ? this.repositories.transaction(persist) : persist()
  }
}
