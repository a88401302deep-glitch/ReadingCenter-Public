// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingCenterRepositories } from '../../src/data'
import { App } from '../../src/app/App'
import { BookService } from '../../src/features/books/book-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'

const state = vi.hoisted(() => ({ repositories: undefined as ReadingCenterRepositories | undefined }))
vi.mock('../../src/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data')>()
  state.repositories = actual.createInMemoryRepositories()
  return { ...actual, createIndexedDbRepositories: () => ({ repositories: state.repositories }) }
})
vi.mock('../../src/features/auth/auth-context', () => ({ useAuth: () => ({ authEnabled: false, logout: vi.fn() }) }))

beforeEach(async () => {
  await Promise.all(Object.values(state.repositories!).map((repository) => repository.clear()))
  window.history.replaceState({}, '')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

describe('App reading entry regression', () => {
  it('saves reading records and long reviews through the restored book controls', async () => {
    const repositories = state.repositories!
    const book = await new BookService(repositories, () => 'book-controls').create({ title: '紀錄與長篇心得操作', mediaTypeId: 'ebook' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    const detail = await screen.findByRole('dialog')
    fireEvent.click(within(detail).getByText('修改狀態／重讀', { exact: true }))
    fireEvent.click(within(detail).getByText('閱讀明細', { exact: true }))
    fireEvent.click(within(detail).getByRole('button', { name: '手動補登（0）' }))
    fireEvent.click(screen.getByRole('button', { name: '新增紀錄' }))
    fireEvent.change(screen.getByLabelText('開始時間'), { target: { value: new Date().toISOString().slice(0, 16) } })
    fireEvent.change(screen.getByLabelText('閱讀時間（分鐘）'), { target: { value: '18' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(within(detail).getByLabelText('單書閱讀統計').textContent).toContain('18 分鐘'))
    expect((await repositories.readingRecords.getAll())[0]).toMatchObject({ bookId: book.id, durationMinutes: 18 })
    fireEvent.click(within(detail).getByRole('button', { name: '手動補登（1）' }))
    fireEvent.click(within(detail).getByRole('button', { name: '長篇心得' }))
    fireEvent.change(screen.getByLabelText('長篇心得內容'), { target: { value: '長篇心得可以儲存' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await within(detail).findByText('長篇心得可以儲存')
    expect((await repositories.readingContents.getAll())[0]).toMatchObject({ bookId: book.id, type: 'longReview', text: '長篇心得可以儲存' })
    window.history.replaceState({}, '')
    fireEvent.click(within(detail).getByRole('button', { name: '關閉' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '閱讀' }))
    await waitFor(() => expect(screen.getByRole('region', { name: '最近閱讀' }).textContent).toContain('紀錄與長篇心得操作'))
    expect(screen.queryByRole('region', { name: '閱讀紀錄時間軸' })).toBeNull()
    expect(within(screen.getByRole('region', { name: '最近閱讀' })).getByText('紀錄與長篇心得操作', { selector: '.sr-only' })).toBeTruthy()
  })

  it('opens real reading data and retains cycle days, short reviews, notes, and import entry', async () => {
    const repositories = state.repositories!
    const book = await new BookService(repositories, () => 'book-regression').create({ title: '閱讀操作驗證', mediaTypeId: 'ebook', rating: { value: 8, scale: 10 } })
    await new ReadingRecordService(repositories, () => 'record-regression').create(book.id, { startedAt: new Date().toISOString(), durationMinutes: 30, progress: { unit: 'percent', value: 25 } })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('region', { name: '最近閱讀' }).textContent).toContain('閱讀操作驗證'))
    const recent = document.querySelector('.recent-book-list') as HTMLElement
    fireEvent.click(within(recent).getByRole('button', { name: '放大《閱讀操作驗證》封面' }))
    expect(screen.getByRole('dialog', { name: '《閱讀操作驗證》封面預覽' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '關閉封面預覽' }))
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: '開啟《閱讀操作驗證》' }))
    const detail = await screen.findByRole('dialog')
    fireEvent.click(within(detail).getByText('修改狀態／重讀', { exact: true }))
    fireEvent.click(within(detail).getByText('閱讀明細', { exact: true }))
    expect(within(detail).getByLabelText('單書閱讀統計').textContent).toContain('30 分鐘')
    expect(within(detail).getByRole('button', { name: '手動補登（1）' })).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: '新增一次閱讀' }))
    fireEvent.change(within(detail).getByLabelText('閱讀天數'), { target: { value: '7' } })
    fireEvent.click(within(detail).getByRole('button', { name: '儲存' }))
    await within(detail).findByText('來源回報閱讀 7 天')
    expect((await repositories.readingCycles.getAll())[0].reportedReadingDays).toBe(7)
    fireEvent.click(within(detail).getByRole('button', { name: '短評' }))
    fireEvent.change(within(detail).getByLabelText('短評內容'), { target: { value: '可操作的短評' } })
    fireEvent.click(within(detail).getByRole('button', { name: '儲存' }))
    await within(detail).findByText('可操作的短評')
    window.history.replaceState({}, '')
    fireEvent.click(within(detail).getByRole('button', { name: '關閉' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    expect(await screen.findByRole('button', { name: /^開啟《/ })).toBeTruthy()
    expect((await repositories.books.getById(book.id))?.rating).toEqual({ value: 8, scale: 10 })
    fireEvent.click(screen.getByRole('button', { name: '閱讀筆記' }))
    await screen.findByText('可操作的短評')
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: '選擇新增方式' }))
    expect(screen.getByRole('button', { name: 'Excel' })).toBeTruthy()
  })

  it('requires confirmation when rating is the only unsaved change', async () => {
    await new BookService(state.repositories!, () => 'book-rating').create({ title: '評分驗證', mediaTypeId: 'ebook' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    fireEvent.click(screen.getByRole('button', { name: '編輯書籍' }))
    fireEvent.change(screen.getByLabelText('評分', { exact: true }), { target: { value: '4' } })
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(confirm).toHaveBeenCalledOnce()
    expect(document.querySelector('.book-form')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(document.querySelector('.book-form')).toBeNull()
    confirm.mockRestore()
  })
})

