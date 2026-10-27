import { assertValidReadingContent, createMetadata, hasLongReview, updateEntity, type EntityId, type EntityMetadata, type HighlightContent, type IsoDateTime, type LongReviewContent, type ReadingContent, type ShortReviewContent } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'

interface ContentDraftBase { cycleId?: EntityId | null; readingRecordId?: EntityId | null; recordedForAt?: IsoDateTime | null; text: string }
export type ReadingContentDraft =
  | (ContentDraftBase & { type: 'highlight'; note?: string | null; locator?: string | null })
  | (ContentDraftBase & { type: 'shortReview' })
  | (ContentDraftBase & { type: 'longReview'; title?: string | null })

type ReadingContentFields =
  | Omit<HighlightContent, keyof EntityMetadata>
  | Omit<ShortReviewContent, keyof EntityMetadata>
  | Omit<LongReviewContent, keyof EntityMetadata>

export class ReadingContentService {
  constructor(private readonly repositories: ReadingCenterRepositories, private readonly createId: () => string = () => crypto.randomUUID(), private readonly now: () => IsoDateTime = () => new Date().toISOString()) {}

  async listReadingCycles() { return this.repositories.readingCycles.getAll() }

  async listAll(): Promise<ReadingContent[]> {
    return (await this.repositories.readingContents.getAll()).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  async listForBook(bookId: EntityId): Promise<ReadingContent[]> {
    return (await this.listAll()).filter((content) => content.bookId === bookId)
  }

  async hasLongReview(bookId: EntityId): Promise<boolean> { return hasLongReview(await this.listForBook(bookId)) }

  private async assertRelations(bookId: EntityId, cycleId: EntityId | null, recordId: EntityId | null): Promise<void> {
    if (!(await this.repositories.books.getById(bookId))) throw new Error('找不到所屬書籍')
    const cycle = cycleId ? await this.repositories.readingCycles.getById(cycleId) : undefined
    if (cycleId && (!cycle || cycle.bookId !== bookId)) throw new Error('閱讀週期不屬於這本書')
    const record = recordId ? await this.repositories.readingRecords.getById(recordId) : undefined
    if (recordId && (!record || record.bookId !== bookId)) throw new Error('閱讀紀錄不屬於這本書')
    if (cycleId && record?.cycleId && record.cycleId !== cycleId) throw new Error('閱讀紀錄與閱讀週期不一致')
  }

  private fields(bookId: EntityId, draft: ReadingContentDraft): ReadingContentFields {
    const base = { bookId, cycleId: draft.cycleId ?? null, readingRecordId: draft.readingRecordId ?? null, recordedForAt: draft.recordedForAt ?? null, text: draft.text.trim() }
    if (draft.type === 'highlight') return { ...base, type: draft.type, note: draft.note?.trim() || null, locator: draft.locator?.trim() || null }
    if (draft.type === 'longReview') return { ...base, type: draft.type, title: draft.title?.trim() || null }
    return { ...base, type: draft.type }
  }

  async create(bookId: EntityId, draft: ReadingContentDraft): Promise<ReadingContent> {
    await this.assertRelations(bookId, draft.cycleId ?? null, draft.readingRecordId ?? null)
    const content = { ...createMetadata({ id: this.createId(), now: this.now() }), ...this.fields(bookId, draft) } as ReadingContent
    assertValidReadingContent(content)
    await this.repositories.readingContents.save(content)
    return content
  }

  async update(id: EntityId, draft: ReadingContentDraft, expectedRevision?: number): Promise<ReadingContent> {
    const existing = await this.repositories.readingContents.getById(id)
    if (!existing) throw new Error('找不到要編輯的閱讀內容')
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) throw new Error('資料已有新版本；草稿已保留，請核對最新內容後再儲存')
    if (existing.type !== draft.type) throw new Error('ReadingContent type cannot be changed')
    await this.assertRelations(existing.bookId, draft.cycleId ?? null, draft.readingRecordId ?? null)
    const content = updateEntity(existing, this.fields(existing.bookId, draft) as never, this.now()) as ReadingContent
    assertValidReadingContent(content)
    await this.repositories.readingContents.save(content)
    return content
  }

  async delete(id: EntityId): Promise<void> {
    if (!(await this.repositories.readingContents.getById(id))) throw new Error('找不到要刪除的閱讀內容')
    await this.repositories.readingContents.delete(id)
  }
}
