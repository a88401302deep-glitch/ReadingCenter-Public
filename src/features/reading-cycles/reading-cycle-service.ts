import { assertValidReadingCycle, createMetadata, updateEntity, type EntityId, type IsoDateTime, type ReadingCompletionDate, type ReadingCycle, type ReadingCycleStatus } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'

export interface ReadingCycleDraft {
  status: ReadingCycleStatus
  startedAt?: IsoDateTime | null
  finishedAt?: IsoDateTime | null
  completionDate?: ReadingCompletionDate | null
  reportedReadingDays?: number | null
  reportedDurationMinutes?: number | null
  abandonedReason?: string | null
}

export interface ReadingCycleDeletionImpact { readingRecords: number; readingContents: number }

export class ReadingCycleService {
  constructor(private readonly repositories: ReadingCenterRepositories, private readonly createId: () => string = () => crypto.randomUUID(), private readonly now: () => IsoDateTime = () => new Date().toISOString()) {}

  async listForBook(bookId: EntityId): Promise<ReadingCycle[]> {
    return (await this.repositories.readingCycles.getAll()).filter((cycle) => cycle.bookId === bookId).sort((a, b) => a.sequence - b.sequence)
  }

  async create(bookId: EntityId, draft: ReadingCycleDraft): Promise<ReadingCycle> {
    if (!(await this.repositories.books.getById(bookId))) throw new Error('找不到所屬書籍')
    const existing = await this.listForBook(bookId)
    const cycle: ReadingCycle = {
      ...createMetadata({ id: this.createId(), now: this.now() }), bookId,
      sequence: (existing.at(-1)?.sequence ?? 0) + 1,
      status: draft.status, startedAt: draft.startedAt ?? null, finishedAt: draft.finishedAt ?? null, completionDate: draft.completionDate ?? null,
      reportedReadingDays: draft.reportedReadingDays ?? null,
      reportedDurationMinutes: draft.reportedDurationMinutes ?? null,
      abandonedReason: draft.status === 'abandoned' ? draft.abandonedReason?.trim() || null : null
    }
    assertValidReadingCycle(cycle)
    await this.repositories.readingCycles.save(cycle)
    return cycle
  }

  async update(id: EntityId, draft: ReadingCycleDraft, expectedRevision?: number): Promise<ReadingCycle> {
    const existing = await this.repositories.readingCycles.getById(id)
    if (!existing) throw new Error('找不到要編輯的閱讀週期')
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) throw new Error('資料已有新版本；草稿已保留，請核對最新內容後再儲存')
    const cycle = updateEntity(existing, {
      status: draft.status, startedAt: draft.startedAt ?? null, finishedAt: draft.finishedAt ?? null,
      completionDate: draft.completionDate === undefined ? (draft.status === 'completed' ? existing.completionDate ?? null : null) : draft.completionDate,
      reportedReadingDays: draft.reportedReadingDays === undefined ? existing.reportedReadingDays ?? null : draft.reportedReadingDays,
      reportedDurationMinutes: draft.reportedDurationMinutes === undefined ? existing.reportedDurationMinutes ?? null : draft.reportedDurationMinutes,
      abandonedReason: draft.status === 'abandoned' ? draft.abandonedReason?.trim() || null : null
    }, this.now())
    assertValidReadingCycle(cycle)
    await this.repositories.readingCycles.save(cycle)
    return cycle
  }

  async deletionImpact(id: EntityId): Promise<ReadingCycleDeletionImpact> {
    const [records, contents] = await Promise.all([this.repositories.readingRecords.getAll(), this.repositories.readingContents.getAll()])
    return { readingRecords: records.filter((item) => item.cycleId === id).length, readingContents: contents.filter((item) => item.cycleId === id).length }
  }

  async delete(id: EntityId): Promise<void> {
    if (!(await this.repositories.readingCycles.getById(id))) throw new Error('找不到要刪除的閱讀週期')
    const [records, contents] = await Promise.all([this.repositories.readingRecords.getAll(), this.repositories.readingContents.getAll()])
    await Promise.all(contents.filter((item) => item.cycleId === id).map((item) => this.repositories.readingContents.delete(item.id)))
    await Promise.all(records.filter((item) => item.cycleId === id).map((item) => this.repositories.readingRecords.delete(item.id)))
    await this.repositories.readingCycles.delete(id)
  }
}
