// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingCenterRepositories } from '../../src/data'
import { App } from '../../src/app/App'
import { BookService } from '../../src/features/books/book-service'

const state = vi.hoisted(() => ({ repositories: undefined as ReadingCenterRepositories | undefined }))
vi.mock('../../src/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data')>()
  state.repositories = actual.createInMemoryRepositories()
  return { ...actual, createIndexedDbRepositories: () => ({ repositories: state.repositories }) }
})
vi.mock('../../src/features/auth/auth-context', () => ({ useAuth: () => ({ authEnabled: false, logout: vi.fn() }) }))

beforeEach(async () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  await Promise.all(Object.values(state.repositories!).map(repository => repository.clear()))
  window.history.replaceState({}, '')
})

afterEach(() => vi.restoreAllMocks())

describe('single-book editing', () => {
  it('restores expanded book details, dialog position and edit focus after cancel and save', async () => {
    const service = new BookService(state.repositories!, () => 'return-book')
    const book = await service.create({ title: '編輯返回', mediaTypeId: 'ebook', sourceUrls: ['https://example.com/retained'] })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    const dialog = screen.getByRole('dialog')
    const publication = dialog.querySelector('.book-detail-publication') as HTMLDetailsElement
    fireEvent.click(within(dialog).getByText(/^出版與來源資料/))
    const trigger = within(dialog).getByRole('button', { name: '編輯書籍' })
    dialog.scrollTop = 123
    fireEvent.click(trigger)
    const editor = document.querySelector('.book-form') as HTMLElement
    expect(within(editor).getByLabelText('出版書名')).toBe(document.activeElement)
    fireEvent.change(within(editor).getByLabelText('書籍備註'), { target: { value: '未保存' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    expect(document.querySelector('.book-form')).toBe(editor)
    expect(within(editor).getByLabelText('書籍備註')).toHaveProperty('value', '未保存')
    confirm.mockReturnValue(true)
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    expect(document.querySelector('.book-form')).toBeNull()
    expect(publication.open).toBe(true)
    expect(dialog.scrollTop).toBe(123)
    expect(document.activeElement).toBe(trigger)
    expect(await service.get(book.id)).toMatchObject({ bookNote: '', sourceUrls: ['https://example.com/retained'] })
    fireEvent.click(trigger)
    const nextEditor = document.querySelector('.book-form') as HTMLElement
    fireEvent.change(within(nextEditor).getByLabelText('書籍備註'), { target: { value: '已保存' } })
    fireEvent.click(within(nextEditor).getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(document.querySelector('.book-form')).toBeNull())
    expect(publication.open).toBe(true)
    expect(dialog.scrollTop).toBe(123)
    expect(document.activeElement).toBe(trigger)
    expect(await service.get(book.id)).toMatchObject({ bookNote: '已保存', sourceUrls: ['https://example.com/retained'] })
  })

  it('saves from a cover, retains search, and protects a dirty draft when cancelling', async () => {
    const service = new BookService(state.repositories!, () => 'inline-book')
    const book = await service.create({ title: '清單編輯', mediaTypeId: 'ebook', wordCount: 12345 })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    fireEvent.click(screen.getByRole('button', { name: '編輯書籍' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const editor = document.querySelector('.book-form') as HTMLElement
    fireEvent.change(within(editor).getByLabelText('書籍備註'), { target: { value: '保留草稿' } })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋書庫' }), { target: { value: '不符合書名' } })
    expect(within(editor).getByLabelText('書籍備註')).toHaveProperty('value', '保留草稿')
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    expect(confirm).toHaveBeenCalled()
    expect(document.querySelector('.book-form')).toBeTruthy()
    fireEvent.click(within(editor).getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(document.querySelector('.book-form')).toBeNull())
    expect(screen.getByRole('searchbox', { name: '搜尋書庫' })).toHaveProperty('value', '不符合書名')
    expect(await state.repositories!.books.getById(book.id)).toMatchObject({ bookNote: '保留草稿', wordCount: 12345 })
    fireEvent.change(screen.getByLabelText('書籍閱讀狀態'), { target: { value: 'planned' } })
    await waitFor(async () => expect(await state.repositories!.readingCycles.getAll()).toEqual([expect.objectContaining({ bookId: book.id, status: 'planned', startedAt: null, finishedAt: null })]))
    confirm.mockRestore()
  })

  it('keeps the draft visible when a concurrent revision prevents saving', async () => {
    const service = new BookService(state.repositories!, () => 'inline-conflict')
    const book = await service.create({ title: '衝突測試', mediaTypeId: 'ebook' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    fireEvent.click(screen.getByRole('button', { name: '編輯書籍' }))
    const editor = document.querySelector('.book-form') as HTMLElement
    fireEvent.change(within(editor).getByLabelText('書籍備註'), { target: { value: '本機草稿' } })
    await service.update(book.id, { title: book.title, mediaTypeId: book.mediaTypeId, bookNote: '另一裝置修改' }, book.revision)
    fireEvent.click(within(editor).getByRole('button', { name: '儲存' }))
    await within(editor).findByText('資料已有新版本；草稿已保留，請核對最新內容後再儲存')
    expect(within(editor).getByLabelText('書籍備註')).toHaveProperty('value', '本機草稿')
    expect(await state.repositories!.books.getById(book.id)).toMatchObject({ bookNote: '另一裝置修改' })
  })
})
