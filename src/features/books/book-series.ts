import { createMetadata, type Book, type BookCollection } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'
import type { BookDraft } from './book-service'

export async function planBookSeries(repositories: ReadingCenterRepositories, book: Book | undefined, draft: BookDraft, now: string) {
  let collectionId = draft.collectionId === undefined ? book?.collectionId ?? null : draft.collectionId
  let addition: BookCollection | undefined
  if (draft.newSeriesName !== undefined) {
    const name = draft.newSeriesName.trim()
    if (!name || name.length > 200 || collectionId) throw new Error('請選擇既有系列，或輸入新的系列名稱')
    // New means new identity, even if another series has the same name.
    addition = { ...createMetadata({ id: crypto.randomUUID(), now }), kind: 'series', name }
    collectionId = addition.id
  } else if (draft.collectionId) {
    const collection = await repositories.collections.getById(draft.collectionId)
    if (!collection || collection.kind !== 'series') throw new Error('找不到所選系列，請重新選擇')
  }
  const sequence = draft.sequence === undefined ? book?.sequence ?? null : draft.sequence
  if (sequence && (!sequence.label.trim() || sequence.label.length > 100 || !Number.isFinite(sequence.sortValue) || sequence.sortValue < 0)) throw new Error('卷次與排序格式無效')
  if (draft.sequence !== undefined && sequence && !collectionId) throw new Error('填寫卷次前請先選擇系列')
  return { addition, fields: { collectionId, sequence } }
}

export const bookFormName = (book: Book) => book.bookForm === 'novel' ? '小說' : book.bookForm === 'manga' || (!book.bookForm && book.mediaTypeId === 'manga') ? '漫畫' : '其他／未分類'

export function seriesBooks(books: readonly Book[], collectionId: string): Book[] {
  return books.filter(book => book.collectionId === collectionId).sort((a, b) => {
    const form = bookFormName(a).localeCompare(bookFormName(b), 'zh-TW')
    if (form) return form
    const order = (book: Book) => book.sequence && book.sequence.sortValue > 0 ? book.sequence.sortValue : Number.POSITIVE_INFINITY
    const ao = order(a), bo = order(b)
    return (ao === bo ? 0 : ao - bo) || a.title.localeCompare(b.title, 'zh-TW') || a.id.localeCompare(b.id)
  })
}
