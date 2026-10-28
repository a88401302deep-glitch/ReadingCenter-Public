// @vitest-environment jsdom
import { enterManagement } from './book-management-test-helpers'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReadingCenterRepositories } from '../../src/data'
import { App } from '../../src/app/App'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'

const state = vi.hoisted(() => ({ repositories: undefined as ReadingCenterRepositories | undefined }))
vi.mock('../../src/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data')>()
  state.repositories = actual.createInMemoryRepositories()
  return { ...actual, createIndexedDbRepositories: () => ({ repositories: state.repositories }) }
})
vi.mock('../../src/features/auth/auth-context', () => ({ useAuth: () => ({ authEnabled: false, logout: vi.fn() }) }))

beforeEach(async () => {
  await Promise.all(Object.values(state.repositories!).map(repository => repository.clear()))
  window.history.replaceState({}, '')
})

describe('library reading entries', () => {
  it('shows only three management entries while records and reviews remain visible without changing data', async () => {
    const repositories = state.repositories!
    const book = await new BookService(repositories).create({ title: '安靜瀏覽', mediaTypeId: 'ebook', bookNote: '書籍備註直接可讀' })
    const cycle = await new ReadingCycleService(repositories).create(book.id, { status: 'reading', reportedDurationMinutes: 100 })
    await new ReadingRecordService(repositories).create(book.id, { cycleId: cycle.id, startedAt: '2026-10-02T10:30:00Z', durationMinutes: 20, progress: { unit: 'percent', value: 40 } })
    await new ReadingContentService(repositories).create(book.id, { type: 'shortReview', text: '內容可以直接閱讀' })
    const snapshot = () => Promise.all([repositories.books.getAll(), repositories.readingCycles.getAll(), repositories.readingRecords.getAll(), repositories.readingContents.getAll()])
    const before = await snapshot()
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: '開啟《安靜瀏覽》' }))
    await screen.findByText('內容可以直接閱讀')
    const view = document.querySelector('.book-detail-view') as HTMLElement
    expect(within(view).getAllByRole('button').map(button => button.textContent)).toEqual(['編輯書籍資料', '編輯閱讀紀錄', '編輯心得'])
    expect(within(view).getByText('書籍備註直接可讀')).toBeTruthy()
    expect(within(view).getByRole('region', { name: '第 1 次閱讀明細' }).textContent).toContain('20 分鐘')
    expect(view.querySelector('details')).toBeNull()
      fireEvent.click(within(view).getByRole('button', { name: '編輯書籍資料' }))
      const directEditor = screen.getByRole('dialog', { name: '編輯書籍' })
      expect(within(directEditor).getByLabelText('查詢書名')).toBeTruthy()
      expect(within(directEditor).getByLabelText('出版書名')).toHaveProperty('value', '安靜瀏覽')
      fireEvent.click(within(directEditor).getByRole('button', { name: '離開書籍編輯' }))
      fireEvent.click(within(view).getByRole('button', { name: '完成書籍編輯' }))
    expect(within(view).queryByRole('combobox')).toBeNull()
    expect(within(view).queryByRole('img', { name: 'ISBN待編輯' })).toBeNull()
    for (const scope of ['書籍', '閱讀', '心得'] as const) {
      enterManagement(scope)
      expect(within(view).getByRole('button', { name: `完成${scope}編輯` })).toBeTruthy()
      fireEvent.click(within(view).getByRole('button', { name: `完成${scope}編輯` }))
      expect(within(view).getAllByRole('button')).toHaveLength(3)
      expect(within(view).getByText('內容可以直接閱讀')).toBeTruthy()
    }
    enterManagement('心得')
    fireEvent.click(within(view).getByRole('button', { name: '短評' }))
    fireEvent.change(screen.getByLabelText('短評內容'), { target: { value: '未儲存的心得草稿' } })
    expect(within(view).getByRole('button', { name: '完成心得編輯' })).toHaveProperty('disabled', true)
    expect(screen.getByLabelText('短評內容')).toHaveProperty('value', '未儲存的心得草稿')
    fireEvent.click(within(document.querySelector('.content-form') as HTMLElement).getByRole('button', { name: '取消' }))
    fireEvent.click(within(view).getByRole('button', { name: '完成心得編輯' }))
    expect(within(view).getAllByRole('button')).toHaveLength(3)
    expect(await snapshot()).toEqual(before)
  })
  it('keeps publication data separate from reading facts without writing while browsing', async () => {
    const book = await new BookService(state.repositories!, () => 'sections-book').create({ title: '分區檢查', mediaTypeId: 'ebook', sourceUrls: ['https://example.com/source'], bookNote: '這是書籍備註' })
    const before = await state.repositories!.books.getById(book.id)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    const dialog = screen.getByRole('dialog', { name: '《分區檢查》' })
    const information = within(dialog).getByRole('region', { name: '書籍資料' })
    const reading = within(dialog).getByRole('region', { name: /^閱讀紀錄$/ })
    const writing = within(dialog).getByRole('region', { name: '閱讀心得' })
    expect(within(information).getByText('圖書分類', { exact: true })).toBeTruthy()
    const personal = within(dialog).getByRole('region', { name: '我的分類與標籤' })
    expect(within(personal).getByRole('heading', { name: '標籤' })).toBeTruthy()
    expect(within(information).queryByRole('button', { name: '短評' })).toBeNull()
    expect(within(reading).getByRole('region', { name: '單書閱讀統計' })).toBeTruthy()
    enterManagement('心得')
    expect(within(writing).getByRole('button', { name: '短評' })).toBeTruthy()
    expect(information.querySelector('.book-detail-publication')).toBeNull()
    expect(within(information).getByText('ISBN').parentElement?.textContent).toContain('未提供')
    expect(within(personal).getByRole('link', { name: 'https://example.com/source' })).toBeTruthy()
    expect(within(information).getByText('這是書籍備註')).toBeTruthy()
    await waitFor(() => expect(within(reading).queryByRole('status')).toBeNull())
    expect(await state.repositories!.books.getById(book.id)).toEqual(before)
    expect(await state.repositories!.readingRecords.getAll()).toHaveLength(0)
    expect(await state.repositories!.readingCycles.getAll()).toHaveLength(0)
    expect(await state.repositories!.readingContents.getAll()).toHaveLength(0)
  })

  it('creates a record and an undated short review from the cover entry', async () => {
    const book = await new BookService(state.repositories!, () => 'entry-book').create({ title: '清單閱讀', mediaTypeId: 'ebook' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    enterManagement('閱讀')
    fireEvent.click(screen.getByRole('button', { name: '更新未分次紀錄（0）' }))
    fireEvent.click(screen.getByRole('button', { name: '新增紀錄' }))
    const recordForm = document.querySelector('.record-form') as HTMLElement
    expect(screen.getByRole('dialog', { name: '《清單閱讀》' })).toBeTruthy()
    fireEvent.change(within(recordForm).getByLabelText('開始時間'), { target: { value: '2026-10-04T10:30' } })
    fireEvent.change(within(recordForm).getByLabelText('閱讀時間（分鐘）'), { target: { value: '25' } })
    fireEvent.change(within(recordForm).getByLabelText('目前進度'), { target: { value: '40' } })
    fireEvent.click(within(recordForm).getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(document.querySelector('.record-form')).toBeNull())
    expect(await state.repositories!.readingRecords.getAll()).toEqual([expect.objectContaining({ bookId: book.id, startedAt: new Date('2026-10-04T10:30').toISOString(), durationMinutes: 25, progress: { unit: 'percent', value: 40 }, cycleId: null })])
    enterManagement('閱讀')
    fireEvent.click(screen.getByRole('button', { name: '更新未分次紀錄（1）' }))
    enterManagement('心得')
    fireEvent.click(screen.getByRole('button', { name: '短評' }))
    const reviewForm = document.querySelector('.content-form') as HTMLElement
    fireEvent.change(within(reviewForm).getByLabelText('短評內容'), { target: { value: '沒有確切日期的心得' } })
    fireEvent.change(screen.getByRole('searchbox', { name: '搜尋書庫' }), { target: { value: '不相符' } })
    fireEvent.click(within(reviewForm).getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(document.querySelector('.content-form')).toBeNull())
    expect(await state.repositories!.readingContents.getAll()).toEqual([expect.objectContaining({ bookId: book.id, type: 'shortReview', recordedForAt: null, text: '沒有確切日期的心得' })])
    expect(screen.getByRole('searchbox', { name: '搜尋書庫' })).toHaveProperty('value', '不相符')
  })
  it('preserves the entered record when end time is earlier than start time', async () => {
    await new BookService(state.repositories!, () => 'entry-error').create({ title: '錯誤保留', mediaTypeId: 'ebook' })
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    fireEvent.click(await screen.findByRole('button', { name: /^開啟《/ }))
    enterManagement('閱讀')
    fireEvent.click(screen.getByRole('button', { name: '更新未分次紀錄（0）' }))
    fireEvent.click(screen.getByRole('button', { name: '新增紀錄' }))
    const form = document.querySelector('.record-form') as HTMLElement
    fireEvent.change(within(form).getByLabelText('開始時間'), { target: { value: '2026-10-04T10:30' } })
    fireEvent.change(within(form).getByLabelText('結束時間'), { target: { value: '2026-10-04T09:30' } })
    fireEvent.click(within(form).getByRole('button', { name: '儲存' }))
    await within(form).findByRole('alert')
    expect(within(form).getByLabelText('開始時間')).toHaveProperty('value', '2026-10-04T10:30')
    expect(await state.repositories!.readingRecords.getAll()).toHaveLength(0)
  })
})

