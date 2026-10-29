import { assertValidBook, getBookNotes, getBookSourceUrls, createMetadata, updateEntity, type Book, type BookCover, type BookRating, type BookSequence, type EntityId, type IsoDateTime } from '../../domain'
import { planBookMetadata, type BookMetadataDraft } from './book-metadata-plan'
import { planBookSeries } from './book-series'
import type { ReadingCenterRepositories } from '../../data'

export interface BookDraft extends BookMetadataDraft { reservedId?: EntityId; sourceIds?: EntityId[]; originalTitle?: string | null; authorOriginalNames?: string[]; bookForm?: Book['bookForm']; collectionId?: string | null; newSeriesName?: string; sequence?: BookSequence | null; wordCount?: number | null; wordCountSourceUrl?: string | null; sourceUrls?: string[]; title: string; preferredTitle?: string | null; languageTag?: string; mediaTypeId: EntityId; bookNote?: string; cover?: BookCover | null; rating?: BookRating | null; categoryIds?: EntityId[]; tagIds?: EntityId[] }
export interface BookDeletionImpact { readingCycles: number; readingRecords: number; readingContents: number }

export class BookService {
  constructor(private readonly repositories: ReadingCenterRepositories, private readonly createId: () => string = () => crypto.randomUUID(), private readonly now: () => IsoDateTime = () => new Date().toISOString()) {}

  async list(): Promise<Book[]> {
    return (await this.repositories.books.getAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }
  get(id: EntityId): Promise<Book | undefined> { return this.repositories.books.getById(id) }

  async create(draft: BookDraft): Promise<Book> {
    const persist = async () => {
    const id = draft.reservedId ?? this.createId()
    if (await this.repositories.books.getById(id)) throw new Error('此書籍識別已存在，未覆寫既有書籍')
    const now = this.now(), metadata = await planBookMetadata(this.repositories, undefined, draft, now)
    const series = await planBookSeries(this.repositories, undefined, draft, now)
    const book: Book = { ...createMetadata({ id, now }), title: draft.title.trim(), preferredTitle: draft.preferredTitle?.trim() || null, subtitle: null, originalTitle: draft.originalTitle?.trim() || null, authorOriginalNames: draft.authorOriginalNames ?? [], bookForm: draft.bookForm ?? (draft.mediaTypeId === 'manga' ? 'manga' : 'other'), languageTag: draft.languageTag?.trim() || 'und', titleAliases: [], externalReferences: [], publicationKind: 'published', collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null, authorIds: [], publisherId: null, mediaTypeId: draft.mediaTypeId.trim(), categoryIds: draft.categoryIds ?? [], tagIds: draft.tagIds ?? [], sourceIds: draft.sourceIds ?? [], cover: draft.cover ?? null, rating: draft.rating ?? null, sourceUrls: draft.sourceUrls ?? [], wordCount: draft.wordCount ?? null, wordCountSourceUrl: draft.wordCountSourceUrl ?? null, bookNote: draft.bookNote?.trim() ?? '' }
    Object.assign(book, metadata.fields, series.fields)
    if (draft.metadataSourceUrl) book.sourceUrls = [...new Set([...(book.sourceUrls ?? []), draft.metadataSourceUrl])]
    assertValidBook(book)
    if (series.addition) await this.repositories.collections.save(series.addition)
    for (const entry of metadata.additions) await this.repositories.dictionaries.save(entry)
    await this.repositories.books.save(book)
    return book
    }
    return this.repositories.transaction ? this.repositories.transaction(persist) : persist()
  }

  async update(id: EntityId, draft: BookDraft, expectedRevision?: number): Promise<Book> {
    const persist = async () => {
    const existing = await this.get(id)
    if (!existing) throw new Error('找不到要編輯的書籍')
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) throw new Error('資料已有新版本；草稿已保留，請核對最新內容後再儲存')
    const now = this.now(), metadata = await planBookMetadata(this.repositories, existing, draft, now)
    const series = await planBookSeries(this.repositories, existing, draft, now)
    const notes = getBookNotes(existing)
    const book = updateEntity(existing, { wordCountSourceUrl: draft.wordCountSourceUrl === undefined ? draft.wordCount !== undefined && draft.wordCount !== existing.wordCount ? null : existing.wordCountSourceUrl ?? null : draft.wordCountSourceUrl, originalTitle: draft.originalTitle === undefined ? existing.originalTitle : draft.originalTitle?.trim() || null, authorOriginalNames: draft.authorOriginalNames ?? existing.authorOriginalNames, bookForm: draft.bookForm ?? existing.bookForm, wordCount: draft.wordCount === undefined ? existing.wordCount ?? null : draft.wordCount, sourceUrls: draft.sourceUrls ?? getBookSourceUrls(existing), title: draft.title.trim(), preferredTitle: draft.preferredTitle?.trim() || null, languageTag: draft.languageTag?.trim() || existing.languageTag, mediaTypeId: draft.mediaTypeId.trim(), cover: draft.cover ?? null, rating: draft.rating === undefined ? existing.rating ?? null : draft.rating, bookNote: draft.bookNote === undefined ? notes.bookNote : draft.bookNote.trim(), ...(notes.importSourceNotes !== undefined ? { importSourceNotes: notes.importSourceNotes } : {}), sourceIds: draft.sourceIds ?? existing.sourceIds, categoryIds: draft.categoryIds ?? existing.categoryIds, tagIds: draft.tagIds ?? existing.tagIds }, now)
    Object.assign(book, metadata.fields, series.fields)
    if (draft.metadataSourceUrl) book.sourceUrls = [...new Set([...(book.sourceUrls ?? []), draft.metadataSourceUrl])]
    assertValidBook(book)
    if (series.addition) await this.repositories.collections.save(series.addition)
    for (const entry of metadata.additions) await this.repositories.dictionaries.save(entry)
    await this.repositories.books.save(book)
    return book
    }
    return this.repositories.transaction ? this.repositories.transaction(persist) : persist()
  }

  async updateRating(id: EntityId, rating: BookRating, expectedRevision: number): Promise<Book> {
    const persist = async () => {
      const existing = await this.get(id)
      if (!existing) throw new Error('找不到要評分的書籍')
      if (existing.revision !== expectedRevision) throw new Error('書籍已有新版本，評分尚未儲存；請核對最新內容後再試')
      const book = updateEntity(existing, { rating }, this.now())
      assertValidBook(book)
      await this.repositories.books.save(book)
      return book
    }
    return this.repositories.transaction ? this.repositories.transaction(persist) : persist()
  }

  async deletionImpact(bookId: EntityId): Promise<BookDeletionImpact> {
    const [cycles, records, contents] = await Promise.all([this.repositories.readingCycles.getAll(), this.repositories.readingRecords.getAll(), this.repositories.readingContents.getAll()])
    return { readingCycles: cycles.filter((x) => x.bookId === bookId).length, readingRecords: records.filter((x) => x.bookId === bookId).length, readingContents: contents.filter((x) => x.bookId === bookId).length }
  }

  async delete(id: EntityId): Promise<void> {
    if (!(await this.get(id))) throw new Error('找不到要刪除的書籍')
    const [cycles, records, contents] = await Promise.all([this.repositories.readingCycles.getAll(), this.repositories.readingRecords.getAll(), this.repositories.readingContents.getAll()])
    await Promise.all(contents.filter((x) => x.bookId === id).map((x) => this.repositories.readingContents.delete(x.id)))
    await Promise.all(records.filter((x) => x.bookId === id).map((x) => this.repositories.readingRecords.delete(x.id)))
    await Promise.all(cycles.filter((x) => x.bookId === id).map((x) => this.repositories.readingCycles.delete(x.id)))
    await this.repositories.books.delete(id)
  }
}
