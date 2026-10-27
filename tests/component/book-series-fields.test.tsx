// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { BookForm } from '../../src/features/books/BookForm'
import { BookSeriesList } from '../../src/features/library/BookSeriesList'
import { BookService, type BookDraft } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data/in-memory-repositories'

it('keeps supplementary fields as a draft until save and restores them for editing', async () => {
  const repo = createInMemoryRepositories(), service = new BookService(repo)
  const submit = vi.fn(async (draft: BookDraft) => { await service.create(draft) })
  const view = render(<BookForm onCancel={vi.fn()} onSubmit={submit} />)
  fireEvent.change(screen.getByLabelText('出版書名'), { target: { value: '翻譯書名' } })
  fireEvent.change(screen.getByLabelText('原文書名', { exact: true }), { target: { value: 'Original' } })
  fireEvent.change(screen.getByLabelText('作者原名（每行一位）'), { target: { value: 'Original Author' } })
  fireEvent.change(screen.getByLabelText('譯者（每行一位）'), { target: { value: '譯者甲\n譯者乙' } })
  fireEvent.change(screen.getByLabelText('繪者／插畫者（每行一位）'), { target: { value: 'Blaze Wu' } })
  fireEvent.change(screen.getByLabelText('類型'), { target: { value: 'novel' } })
  fireEvent.change(screen.getByLabelText('系列名稱'), { target: { value: '__new' } })
  fireEvent.change(screen.getByLabelText('新系列名稱'), { target: { value: '幻影都城' } })
  fireEvent.change(screen.getByLabelText('卷次／集數'), { target: { value: '第 1 集' } })
  fireEvent.change(screen.getByLabelText('卷次排序（選填）'), { target: { value: '1' } })
  expect(submit).not.toHaveBeenCalled()
  expect(await repo.books.getAll()).toEqual([])
  expect(await repo.collections.getAll()).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  await waitFor(() => expect(submit).toHaveBeenCalledOnce())
  const [book] = await repo.books.getAll()
  expect(book).toBeDefined()
  view.unmount()
  render(<BookForm book={book} dictionaries={await repo.dictionaries.getAll()} collections={await repo.collections.getAll()} onCancel={vi.fn()} onSubmit={vi.fn()} />)
  expect(screen.getByLabelText('原文書名', { exact: true })).toHaveProperty('value', 'Original')
  expect(screen.getByLabelText('譯者（每行一位）')).toHaveProperty('value', '譯者甲\n譯者乙')
  expect(screen.getByLabelText('繪者／插畫者（每行一位）')).toHaveProperty('value', 'Blaze Wu')
  expect(screen.getByLabelText('系列名稱')).toHaveProperty('value', book.collectionId)
})

it('lists confirmed members with form and volume labels while excluding an identically named other series', async () => {
  const repo = createInMemoryRepositories(), service = new BookService(repo)
  const book = await service.create({ title: '小說第 1 集', mediaTypeId: 'ebook', bookForm: 'novel', newSeriesName: '同名系列', sequence: { kind: 'volume', label: '1', sortValue: 1 } })
  await service.create({ title: '漫畫第 1 集', mediaTypeId: 'manga', bookForm: 'manga', collectionId: book.collectionId })
  await service.create({ title: '其他系列作品', mediaTypeId: 'ebook', newSeriesName: '同名系列' })
  render(<BookSeriesList book={book} books={await repo.books.getAll()} collections={await repo.collections.getAll()} />)
  expect(screen.getByText('系列：同名系列 · 同系列書籍（2 本）')).not.toBeNull()
  expect(screen.getByText('小說｜1｜小說第 1 集')).not.toBeNull()
  expect(screen.getByText('漫畫｜卷次未設定｜漫畫第 1 集')).not.toBeNull()
  expect(screen.queryByText(/其他系列作品/)).toBeNull()
})

