// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { createMetadata, type DictionaryEntry } from '../../src/domain'
import { BookForm } from '../../src/features/books/BookForm'
import { BookService, type BookDraft } from '../../src/features/books/book-service'

const dictionaries: DictionaryEntry[] = [
  { ...createMetadata({ id: 'source-old', now: '2026-10-24T00:00:00.000Z' }), kind: 'source', name: '原有圖書館', color: null },
  { ...createMetadata({ id: 'source-new', now: '2026-10-24T00:00:00.000Z' }), kind: 'source', name: '電子書平台', color: null },
  { ...createMetadata({ id: 'tag-old', now: '2026-10-24T00:00:00.000Z' }), kind: 'tag', name: '收藏', color: null },
]

it('edits personal classification and sources without exposing or changing bibliography', async () => {
  const repositories = createInMemoryRepositories()
  const service = new BookService(repositories, () => 'scope-book')
  const book = await service.create({ title: '書目原名', preferredTitle: '顯示名稱', mediaTypeId: 'ebook', languageTag: 'ja',
    publisherName: '原出版社', authorNames: ['原作者'], isbn: '9780140328721', bookForm: 'novel',
    categoryIds: ['category-old'], tagIds: ['tag-old'], sourceIds: ['source-old'], wordCount: 40000,
    cover: { path: 'covers/retained.webp', mimeType: 'image/webp' }, rating: { value: 4, scale: 5 }, bookNote: '保留備註' })
  const save = vi.fn(async (draft: BookDraft) => { await service.update(book.id, draft, book.revision) })
  const dirty = vi.fn()
  render(<BookForm scope="personal" book={book} dictionaries={dictionaries} onCancel={vi.fn()} onSubmit={save} onDirtyChange={dirty} />)
  expect(screen.getByRole('heading', { name: '編輯我的分類與標籤' })).toBeTruthy()
  for (const name of ['出版書名', '出版社', 'ISBN', '書籍版本', '書籍備註', '書籍字數', '選擇封面', '評分']) expect(screen.queryByLabelText(name)).toBeNull()
  expect(screen.queryByRole('button', { name: '搜尋並補全書籍資料' })).toBeNull()
  expect(dirty).toHaveBeenLastCalledWith(false)
  fireEvent.click(screen.getByRole('button', { name: '移除原有圖書館' }))
  fireEvent.change(screen.getByLabelText('搜尋書籍來源'), { target: { value: '電子書' } })
  fireEvent.click(screen.getByRole('option', { name: '電子書平台' }))
  fireEvent.change(screen.getByLabelText('類型'), { target: { value: 'manga' } })
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  await waitFor(async () => expect(await service.get(book.id)).toEqual({ ...book, revision: book.revision + 1, updatedAt: expect.any(String), bookForm: 'manga', sourceIds: ['source-new'] }))
  expect(dirty).toHaveBeenLastCalledWith(true)
})

it('edits bibliography without exposing personal controls or overwriting their values', async () => {
  const service = new BookService(createInMemoryRepositories(), () => 'bib-book')
  const book = await service.create({ title: '原書名', mediaTypeId: 'ebook', sourceIds: ['source-old'], tagIds: ['tag-old'], bookForm: 'manga', rating: { value: 8, scale: 10 }, sourceUrls: ['https://example.com/source'], cover: { path: 'covers/original.png', mimeType: 'image/png' } })
  const save = vi.fn(async (draft: BookDraft) => { await service.update(book.id, draft, book.revision) })
  render(<BookForm scope="bibliography" book={book} dictionaries={dictionaries} onCancel={vi.fn()} onSubmit={save} />)
  expect(screen.getByRole('button', { name: '搜尋並補全書籍資料' })).toBeTruthy()
  for (const name of ['類型', '搜尋書籍來源', '搜尋標籤', '書籍網址（每行一個）', '選擇封面', '評分']) expect(screen.queryByLabelText(name)).toBeNull()
  fireEvent.change(screen.getByLabelText('出版書名'), { target: { value: '修正書名' } })
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  await waitFor(async () => expect(await service.get(book.id)).toEqual({ ...book, title: '修正書名', revision: book.revision + 1, updatedAt: expect.any(String) }))
})

it('preserves an unloaded source and allows explicitly clearing it', async () => {
  const service = new BookService(createInMemoryRepositories(), () => 'unloaded-source')
  const book = await service.create({ title: '來源待載入', mediaTypeId: 'ebook', sourceIds: ['private-source-id'] })
  const save = vi.fn(async () => {})
  render(<BookForm scope="personal" book={book} onCancel={vi.fn()} onSubmit={save} />)
  expect(screen.queryByText(/private-source-id/)).toBeNull()
  expect(screen.getByRole('button', { name: '移除原有來源' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: ['private-source-id'] }))
  await waitFor(() => expect(screen.getByRole('button', { name: '儲存' })).toHaveProperty('disabled', false))
  fireEvent.click(screen.getByRole('button', { name: '移除原有來源' }))
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ sourceIds: [] }))
})

it('keeps rating editable through a separate scope while preserving both other sections', async () => {
  const service = new BookService(createInMemoryRepositories(), () => 'rating-scope')
  const book = await service.create({ title: '評分書籍', mediaTypeId: 'ebook', sourceIds: ['source-old'], bookForm: 'novel', wordCount: 25000 })
  const save = vi.fn(async (draft: BookDraft) => { await service.update(book.id, draft, book.revision) })
  render(<BookForm scope="rating" book={book} onCancel={vi.fn()} onSubmit={save} />)
  expect(screen.getByRole('heading', { name: '編輯評分' })).toBeTruthy()
  expect(screen.queryByLabelText('出版書名')).toBeNull()
  expect(screen.queryByLabelText('類型')).toBeNull()
  fireEvent.change(screen.getByLabelText('評分', { exact: true }), { target: { value: '4' } })
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  await waitFor(async () => expect(await service.get(book.id)).toEqual({ ...book, rating: { value: 4, scale: 5 }, revision: book.revision + 1, updatedAt: expect.any(String) }))
})
