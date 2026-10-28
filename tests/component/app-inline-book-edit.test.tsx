// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    const publication = dialog.querySelector('.reading-cycle-unassigned .cycle-record-details') as HTMLDetailsElement
    fireEvent.click(within(dialog).getByText('未分次閱讀明細（0）', { exact: true }))
    const trigger = within(dialog).getByRole('button', { name: '編輯書籍' })
    dialog.scrollTop = 123
    fireEvent.click(trigger)
    const editor = document.querySelector('.book-form') as HTMLElement
    expect(dialog.contains(editor)).toBe(false)
    expect(dialog.getAttribute('aria-hidden')).toBe('true')
    expect(dialog.querySelector('.book-detail-view')).toHaveProperty('hidden', false)
    expect(screen.getByRole('dialog').classList.contains('book-detail-editor-dialog')).toBe(true)
    expect(within(editor).getByLabelText('出版書名')).toBe(document.activeElement)
    fireEvent.change(within(editor).getByLabelText('書籍備註'), { target: { value: '未保存' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    expect(document.querySelector('.book-form')).toBe(editor)
    expect(within(editor).getByLabelText('書籍備註')).toHaveProperty('value', '未保存')
    confirm.mockReturnValue(true)
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    expect(document.querySelector('.book-form')).toBeNull()
    expect(dialog.hasAttribute('aria-hidden')).toBe(false)
    expect(publication.open).toBe(true)
    expect(dialog.scrollTop).toBe(123)
    expect(document.activeElement).toBe(trigger)
    expect(await service.get(book.id)).toMatchObject({ bookNote: '', sourceUrls: ['https://example.com/retained'] })
    fireEvent.click(trigger)
    const nextEditor = document.querySelector('.book-form') as HTMLElement
    fireEvent.change(within(nextEditor).getByLabelText('書籍備註'), { target: { value: '已保存' } })
    const fields = nextEditor.querySelector('.book-form-fields') as HTMLElement
    fields.scrollTop = 80
    fireEvent.click(within(nextEditor).getByRole('button', { name: '儲存' }))
    await screen.findByText('已儲存，可繼續編輯。')
    const savedEditor = document.querySelector('.book-form') as HTMLElement
    expect(savedEditor).toBeTruthy()
    expect(savedEditor.querySelector('.book-form-fields')?.scrollTop).toBe(80)
    expect(document.activeElement).toBe(within(savedEditor).getByRole('button', { name: '儲存' }))
    expect(await service.get(book.id)).toMatchObject({ revision: book.revision + 1, bookNote: '已保存' })
    fireEvent.change(within(savedEditor).getByLabelText('書籍備註'), { target: { value: '第二次保存' } })
    expect(screen.queryByText('已儲存，可繼續編輯。')).toBeNull()
    fireEvent.click(within(savedEditor).getByRole('button', { name: '儲存' }))
    await screen.findByText('已儲存，可繼續編輯。')
    expect(await service.get(book.id)).toMatchObject({ revision: book.revision + 2, bookNote: '第二次保存' })
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    await waitFor(() => expect(document.querySelector('.book-form')).toBeNull())
    expect(publication.open).toBe(true)
    expect(dialog.scrollTop).toBe(123)
    expect(document.activeElement).toBe(trigger)
    expect(await service.get(book.id)).toMatchObject({ bookNote: '第二次保存', sourceUrls: ['https://example.com/retained'] })
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
    await screen.findByText('已儲存，可繼續編輯。')
    expect(document.querySelector('.book-form')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '完成' }))
    await waitFor(() => expect(document.querySelector('.book-form')).toBeNull())
    expect(screen.getByRole('searchbox', { name: '搜尋書庫' })).toHaveProperty('value', '不符合書名')
    expect(await state.repositories!.books.getById(book.id)).toMatchObject({ bookNote: '保留草稿', wordCount: 12345 })
    fireEvent.change(screen.getByLabelText('書籍閱讀狀態'), { target: { value: 'planned' } })
    await waitFor(async () => expect(await state.repositories!.readingCycles.getAll()).toEqual([expect.objectContaining({ bookId: book.id, status: 'planned', startedAt: null, finishedAt: null })]))
    confirm.mockRestore()
  })

  it('blocks duplicate submits and editing while a save is pending', async () => {
    const service = new BookService(state.repositories!, () => 'pending-book')
    const book = await service.create({ title: '等待儲存', mediaTypeId: 'ebook' })
    const update = service.update.bind(service)
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    const spy = vi.spyOn(BookService.prototype, 'update').mockImplementation(async (...args) => {
      await gate
      return update(...args)
    })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    fireEvent.click(screen.getByRole('button', { name: '編輯書籍' }))
    const editor = document.querySelector('.book-form') as HTMLFormElement
    fireEvent.change(within(editor).getByLabelText('書籍備註'), { target: { value: '只儲存一次' } })
    fireEvent.submit(editor)
    fireEvent.submit(editor)
    expect(spy).toHaveBeenCalledTimes(1)
    expect((editor.querySelector('fieldset') as HTMLFieldSetElement).disabled).toBe(true)
    expect((within(editor).getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(document.querySelector('.book-form')).toBe(editor)
    await act(async () => { finish() })
    await screen.findByText('已儲存，可繼續編輯。')
    expect(await service.get(book.id)).toMatchObject({ revision: book.revision + 1, bookNote: '只儲存一次' })
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

it('shows four separate book panels without exposing or changing preserved import evidence', async () => {
 const service = new BookService(state.repositories!, () => 'four-panels')
 const book = await service.create({ title: '四區資訊', mediaTypeId: 'ebook', bookNote: '我寫的備註', isbn: '9780140328721' })
 const saved = { ...book, importSourceNotes: '不應顯示的匯入原始內容' }
 await state.repositories!.books.save(saved)
 render(<App />)
 fireEvent.click(screen.getByRole('button', { name: '書庫' }))
 fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
 const dialog = screen.getByRole('dialog')
 for (const name of ['書籍資料', '我的分類與標籤', '閱讀紀錄', '閱讀心得']) expect(within(dialog).getByRole('region', { name })).toBeTruthy()
 expect(within(dialog).getByText('9780140328721')).toBeTruthy()
 expect(within(dialog).getByText('我寫的備註')).toBeTruthy()
 expect(within(dialog).queryByText('不應顯示的匯入原始內容')).toBeNull()
 expect(dialog.querySelector('.book-detail-publication')).toBeNull()
 expect(await service.get(book.id)).toEqual(saved)
 expect(await state.repositories!.readingRecords.getAll()).toEqual([])
 expect(await state.repositories!.readingCycles.getAll()).toEqual([])
})

it('keeps personal edits in their own dialog across consecutive saves and restores the personal trigger', async () => {
  const service = new BookService(state.repositories!, () => 'personal-book')
  const book = await service.create({ title: '分類編輯', mediaTypeId: 'ebook', sourceIds: ['unloaded-library'], wordCount: 30000 })
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: '書庫' }))
  fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
  const detail = screen.getByRole('dialog')
  const trigger = within(detail).getByRole('button', { name: '編輯我的分類' })
  detail.scrollTop = 200
  fireEvent.click(trigger)
  let editor = screen.getByRole('dialog', { name: '編輯我的分類與標籤' })
  expect(within(editor).queryByLabelText('出版書名')).toBeNull()
  fireEvent.change(within(editor).getByLabelText('類型'), { target: { value: 'novel' } })
  fireEvent.click(within(editor).getByRole('button', { name: '儲存' }))
  await screen.findByText('已儲存，可繼續編輯。')
  editor = screen.getByRole('dialog', { name: '編輯我的分類與標籤' })
  expect(within(editor).getByLabelText('類型')).toHaveProperty('value', 'novel')
  expect(document.activeElement).toBe(within(editor).getByRole('button', { name: '儲存' }))
  fireEvent.click(within(editor).getByRole('button', { name: '移除原有來源' }))
  fireEvent.click(within(editor).getByRole('button', { name: '儲存' }))
  await screen.findByText('已儲存，可繼續編輯。')
  expect(await service.get(book.id)).toMatchObject({ revision: book.revision + 2, title: book.title, wordCount: 30000, bookForm: 'novel', sourceIds: [] })
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  expect(document.querySelector('.book-form')).toBeNull()
  expect(detail.scrollTop).toBe(200)
  expect(document.activeElement).toBe(trigger)
  fireEvent.click(within(detail).getByRole('button', { name: '編輯書籍' }))
  expect(screen.getByRole('dialog', { name: '編輯書籍' })).toBeTruthy()
  expect(screen.getByLabelText('出版書名')).toHaveProperty('value', book.title)
  expect(screen.queryByLabelText('搜尋書籍來源')).toBeNull()
})
