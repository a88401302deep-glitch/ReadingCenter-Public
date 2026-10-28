// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import type { ReadingCycleDraft } from '../../src/features/reading-cycles/reading-cycle-service'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingCycleManager } from '../../src/features/reading-cycles/ReadingCycleManager'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'

async function mount(draft: ReadingCycleDraft) {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories, () => 'date-book').create({ title: '日期顯示測試', mediaTypeId: 'ebook' })
  const service = new ReadingCycleService(repositories, () => 'date-cycle')
  const cycle = await service.create(book.id, draft)
  render(<ReadingCycleManager bookId={book.id} service={service} recordService={new ReadingRecordService(repositories)} contentService={new ReadingContentService(repositories)} />)
  return { repositories, cycle }
}

describe('reading cycle dates', () => {
  it('shows source minute and offset, and preserves it after a days edit', async () => {
    const completionDate = { precision: 'minute' as const, completedOn: '2024-02-25', localTime: '00:05', offsetMinutes: 480 }
    const { repositories, cycle } = await mount({ status: 'completed', completionDate, reportedReadingDays: 7 })
    const label = '完讀：2024-02-25 00:05（UTC+08:00）'
    await screen.findByText(label)
    expect(screen.queryByText('日期未設定')).toBeNull()
    fireEvent.click(within(document.querySelector('.cycle-list') as HTMLElement).getByRole('button', { name: '編輯' }))
    fireEvent.change(screen.getByLabelText('閱讀天數'), { target: { value: '8' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByText('閱讀 8 天')
    await waitFor(async () => expect(await repositories.readingCycles.getById(cycle.id)).toMatchObject({ completionDate, startedAt: null, finishedAt: null, reportedReadingDays: 8 }))
    expect(screen.getByText(label)).toBeTruthy()
    expect(await repositories.readingRecords.getAll()).toHaveLength(0)
  })

  it.each([
    [{ status: 'completed', completionDate: { precision: 'date', completedOn: '2024-02-25' } }, '完讀：2024-02-25'],
    [{ status: 'completed', completionDate: { precision: 'range', startedOn: '2024-02-22', completedOn: '2024-02-25' } }, '完讀日期範圍：2024-02-22－2024-02-25'],
    [{ status: 'completed', completionDate: { precision: 'minute', completedOn: '2024-02-25', localTime: '23:30', offsetMinutes: -210 } }, '完讀：2024-02-25 23:30（UTC-03:30）'],
    [{ status: 'completed', startedAt: '2024-02-22T00:00:00Z', finishedAt: '2024-02-25T00:00:00Z' }, '2024-02-22－2024-02-25'],
    [{ status: 'completed', finishedAt: '2024-02-25T00:00:00Z' }, '結束：2024-02-25'],
    [{ status: 'reading' }, '日期未設定']
  ] satisfies [ReadingCycleDraft, string][])('retains date precision and fallback: %s', async (draft, label) => {
    await mount(draft)
    await screen.findByText(label)
  })
})
