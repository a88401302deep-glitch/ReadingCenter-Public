// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
  await Promise.all(Object.values(state.repositories!).map(repository => repository.clear()))
  window.history.replaceState({}, '')
})

describe('library reading entries', () => {
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
    expect(within(writing).getByRole('button', { name: '短評' })).toBeTruthy()
    expect(information.querySelector('.book-detail-publication')).toBeNull()
    expect(within(information).getByRole('img', { name: 'ISBN待編輯' })).toBeTruthy()
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
    fireEvent.click(screen.getByText('修改狀態／重讀', { exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '手動補登（0）' }))
    fireEvent.click(screen.getByRole('button', { name: '新增紀錄' }))
    const recordForm = document.querySelector('.record-form') as HTMLElement
    expect(screen.getByRole('dialog', { name: '《清單閱讀》' })).toBeTruthy()
    fireEvent.change(within(recordForm).getByLabelText('開始時間'), { target: { value: '2026-10-04T10:30' } })
    fireEvent.change(within(recordForm).getByLabelText('閱讀時間（分鐘）'), { target: { value: '25' } })
    fireEvent.change(within(recordForm).getByLabelText('目前進度'), { target: { value: '40' } })
    fireEvent.click(within(recordForm).getByRole('button', { name: '儲存' }))
    await waitFor(() => expect(document.querySelector('.record-form')).toBeNull())
    expect(await state.repositories!.readingRecords.getAll()).toEqual([expect.objectContaining({ bookId: book.id, startedAt: new Date('2026-10-04T10:30').toISOString(), durationMinutes: 25, progress: { unit: 'percent', value: 40 }, cycleId: null })])
    fireEvent.click(screen.getByRole('button', { name: '手動補登（1）' }))
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
    fireEvent.click(screen.getByText('修改狀態／重讀', { exact: true }))
    fireEvent.click(screen.getByRole('button', { name: '手動補登（0）' }))
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

