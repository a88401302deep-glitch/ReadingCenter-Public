import { assertValidReadingRecord, createMetadata, updateEntity, type EntityId, type IsoDateTime, type ReadingProgress, type ReadingRecord } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'

export interface ReadingRecordDraft {
  cycleId?: EntityId | null
  startedAt: IsoDateTime
  endedAt?: IsoDateTime | null
  durationMinutes?: number | null
  progress?: ReadingProgress | null
  deviceId?: EntityId | null
  sourceId?: EntityId | null
}

export class ReadingRecordService {
  constructor(private readonly repositories: ReadingCenterRepositories, private readonly createId: () => string = () => crypto.randomUUID(), private readonly now: () => IsoDateTime = () => new Date().toISOString()) {}

  async listForBook(bookId: EntityId): Promise<ReadingRecord[]> {
    return (await this.repositories.readingRecords.getAll()).filter((record) => record.bookId === bookId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  }

  private async assertCycle(bookId: EntityId, cycleId: EntityId | null): Promise<void> {
    if (cycleId === null) return
    const cycle = await this.repositories.readingCycles.getById(cycleId)
    if (!cycle || cycle.bookId !== bookId) throw new Error('閱讀週期不屬於這本書')
  }

  async create(bookId: EntityId, draft: ReadingRecordDraft): Promise<ReadingRecord> {
    if (!(await this.repositories.books.getById(bookId))) throw new Error('找不到所屬書籍')
    const cycleId = draft.cycleId ?? null
    await this.assertCycle(bookId, cycleId)
    const record: ReadingRecord = {
      ...createMetadata({ id: this.createId(), now: this.now() }), bookId, cycleId,
      startedAt: draft.startedAt, endedAt: draft.endedAt ?? null,
      durationMinutes: draft.durationMinutes ?? null, progress: draft.progress ?? null,
      deviceId: draft.deviceId ?? null, sourceId: draft.sourceId ?? null
    }
    assertValidReadingRecord(record)
    await this.repositories.readingRecords.save(record)
    return record
  }

  async update(id: EntityId, draft: ReadingRecordDraft, expectedRevision?: number): Promise<ReadingRecord> {
    const existing = await this.repositories.readingRecords.getById(id)
    if (!existing) throw new Error('找不到要編輯的閱讀紀錄')
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) throw new Error('資料已有新版本；草稿已保留，請核對最新內容後再儲存')
    const cycleId = draft.cycleId ?? null
    await this.assertCycle(existing.bookId, cycleId)
    const record = updateEntity(existing, {
      cycleId, startedAt: draft.startedAt, endedAt: draft.endedAt ?? null,
      durationMinutes: draft.durationMinutes ?? null, progress: draft.progress ?? null,
      deviceId: draft.deviceId ?? null, sourceId: draft.sourceId ?? null
    }, this.now())
    assertValidReadingRecord(record)
    await this.repositories.readingRecords.save(record)
    return record
  }

  async delete(id: EntityId): Promise<void> {
    if (!(await this.repositories.readingRecords.getById(id))) throw new Error('找不到要刪除的閱讀紀錄')
    const contents = await this.repositories.readingContents.getAll()
    await Promise.all(contents.filter((content) => content.readingRecordId === id).map((content) =>
      this.repositories.readingContents.save(updateEntity(content, { readingRecordId: null }, this.now()))
    ))
    await this.repositories.readingRecords.delete(id)
  }
}
