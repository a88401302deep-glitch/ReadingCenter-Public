// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReadingCompletionDate } from '../../src/domain'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingCycleManager } from '../../src/features/reading-cycles/ReadingCycleManager'
import { BookReadingCycles } from '../../src/features/reading-cycles/BookReadingCycles'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'

async function fixture() {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories, () => 'group-book').create({ title: '分次閱讀', mediaTypeId: 'ebook' })
  const cycles = new ReadingCycleService(repositories)
  const first = await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-02' }, reportedDurationMinutes: 100, reportedReadingDays: 3 })
  const second = await cycles.create(book.id, { status: 'reading', startedAt: '2026-10-02T00:00:00.000Z' })
  const records = new ReadingRecordService(repositories)
  await records.create(book.id, { cycleId: first.id, startedAt: '2026-10-02T01:00:00.000Z', durationMinutes: 10, progress: { unit: 'percent', value: 30 } })
  await records.create(book.id, { cycleId: second.id, startedAt: '2026-10-02T01:00:00.000Z', durationMinutes: 20, progress: { unit: 'percent', value: 80 } })
  await records.create(book.id, { startedAt: '2026-10-02T01:00:00.000Z', durationMinutes: 7, progress: { unit: 'percent', value: 55 } })
  return { repositories, book, cycles, first, second, records }
}
it('groups overlapping dates by actual cycle IDs and keeps unassigned entries separate without writing', async () => {
  const f = await fixture()
  const before = { cycles: await f.repositories.readingCycles.getAll(), records: await f.repositories.readingRecords.getAll() }
  render(<ReadingCycleManager compact bookId={f.book.id} service={f.cycles} recordService={f.records} contentService={new ReadingContentService(f.repositories)} />)
  const second = await screen.findByRole('region', { name: '第 2 次閱讀' })
  const first = screen.getByRole('region', { name: '第 1 次閱讀' })
  const unassigned = screen.getByRole('region', { name: '未分次紀錄' })
  expect(within(first).getByText('30%')).toBeTruthy()
  expect(within(first).getByRole('region', { name: '第 1 次閱讀明細' }).closest('details')).toBeNull()
  expect(within(first).queryByText('80%')).toBeNull()
  expect(within(second).getByText('80%')).toBeTruthy()
  expect(first.textContent).not.toContain('55%')
  expect(unassigned.textContent).toContain('55%')
  expect(within(first).getByText('100 分鐘')).toBeTruthy()
  expect(first.textContent).not.toContain('110 分鐘')
  expect(within(first).getByText('2026-10-02')).toBeTruthy()
  expect(first.textContent).not.toContain('00:00')
  expect(await f.repositories.readingCycles.getAll()).toEqual(before.cycles)
  expect(await f.repositories.readingRecords.getAll()).toEqual(before.records)
})

it('saves an update into the selected reading and refreshes that group', async () => {
  const f = await fixture()
  const changed = vi.fn()
  render(<ReadingCycleManager compact bookId={f.book.id} service={f.cycles} recordService={f.records} contentService={new ReadingContentService(f.repositories)} onReadingChanged={changed} />)
  const second = await screen.findByRole('region', { name: '第 2 次閱讀' })
  fireEvent.click(await within(second).findByRole('button', { name: '更新閱讀紀錄（1）' }))
  fireEvent.click(screen.getByRole('button', { name: '新增紀錄' }))
  fireEvent.change(screen.getByLabelText('開始時間'), { target: { value: '2026-10-03T12:00' } })
  fireEvent.change(screen.getByLabelText('目前進度'), { target: { value: '90' } })
  fireEvent.click(screen.getByRole('button', { name: '儲存' }))
  await within(second).findByRole('button', { name: '更新閱讀紀錄（2）' })
  await waitFor(() => expect(second.querySelector('.cycle-facts')?.textContent).toContain('90%'))
  const saved = (await f.repositories.readingRecords.getAll()).find(record => record.progress?.value === 90)
  expect(saved).toMatchObject({ cycleId: f.second.id, durationMinutes: null })
  expect((await f.records.listForBook(f.book.id)).filter(record => record.cycleId === f.first.id)).toHaveLength(1)
  expect(changed).toHaveBeenCalledTimes(1)
})

it('offers the first reading without creating a fake cycle while browsing', async () => {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories).create({ title: '尚未分次', mediaTypeId: 'ebook' })
  render(<ReadingCycleManager compact bookId={book.id} service={new ReadingCycleService(repositories)} recordService={new ReadingRecordService(repositories)} contentService={new ReadingContentService(repositories)} />)
  expect(screen.getByRole('button', { name: '新增一次閱讀' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: '第 1 次閱讀' })).toBeNull()
  expect(screen.getByRole('region', { name: '未分次紀錄' })).toBeTruthy()
  expect(screen.queryByText('尚無閱讀明細')).toBeNull()
  expect(screen.queryByText('未分次閱讀明細（0）')).toBeNull()
  expect(await repositories.readingCycles.getAll()).toEqual([])
})

it('keeps unmatched references visible for review and preserves position units', async () => {
  const f = await fixture()
  const records = (await f.records.listForBook(f.book.id)).map(record => ({ ...record, cycleId: 'missing-cycle', progress: { unit: 'position' as const, value: 120, total: 500, label: '位置' } }))
  render(<BookReadingCycles bookId={f.book.id} cycles={[f.first, f.second]} records={records} revision={0} recordService={f.records} onRecordsChanged={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
  const unmatched = screen.getByRole('region', { name: '待核對紀錄' })
  expect(unmatched.textContent).toContain('120 位置')
  expect(unmatched.textContent).not.toContain('120 章')
  expect(screen.queryByText('missing-cycle')).toBeNull()
  expect(records.every(record => record.cycleId === 'missing-cycle')).toBe(true)
})

it('keeps a record draft when leaving management, including after an outside pointer closes its popover', async () => {
  const f = await fixture()
  const before = await f.records.listForBook(f.book.id)
  render(<ReadingCycleManager compact readingSummary={<p>閱讀摘要</p>} bookId={f.book.id} service={f.cycles} recordService={f.records} contentService={new ReadingContentService(f.repositories)} />)
  const second = await screen.findByRole('region', { name: '第 2 次閱讀' })
  expect(within(second).queryByRole('button')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '編輯閱讀紀錄' }))
  fireEvent.click(await within(second).findByRole('button', { name: '更新閱讀紀錄（1）' }))
  fireEvent.click(screen.getByRole('button', { name: '新增紀錄' }))
  fireEvent.change(screen.getByLabelText('目前進度'), { target: { value: '89' } })
  const done = screen.getByRole('button', { name: '完成閱讀編輯' })
  expect(done).toHaveProperty('disabled', true)
  fireEvent.pointerDown(screen.getByText('閱讀摘要'))
  fireEvent.click(done)
  expect(done).toHaveProperty('disabled', true)
  expect(screen.queryByRole('button', { name: '編輯閱讀紀錄' })).toBeNull()
  fireEvent.click(within(second).getByRole('button', { name: '更新閱讀紀錄（1）' }))
  expect(screen.getByLabelText('目前進度')).toHaveProperty('value', '89')
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  fireEvent.click(done)
  expect(screen.getByRole('button', { name: '編輯閱讀紀錄' })).toBeTruthy()
  expect(within(second).queryByRole('button')).toBeNull()
  expect(await f.records.listForBook(f.book.id)).toEqual(before)
})

const dates: { date: ReadingCompletionDate; text: string }[] = [
  { date: { precision: 'minute', completedOn: '2026-10-02', localTime: '00:05', offsetMinutes: 480 }, text: '2026-10-02 00:05（UTC+08:00）' },
  { date: { precision: 'range', startedOn: '2026-09-30', completedOn: '2026-10-02' }, text: '2026-09-30－2026-10-02' },
]
for (const { date, text } of dates) it('preserves completion display precision: ' + date.precision, async () => {
  const f = await fixture()
  render(<BookReadingCycles bookId={f.book.id} cycles={[{ ...f.first, completionDate: date }]} records={[]} revision={0} recordService={f.records} onRecordsChanged={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
  expect(screen.getByText(text)).toBeTruthy()
  expect(screen.queryByRole('region', { name: '第 1 次閱讀明細' })).toBeNull()
})

it('marks only the selected reading complete without inventing progress or adding duration', async () => {
  const f = await fixture()
  const beforeFirst = (await f.cycles.listForBook(f.book.id))[0]
  const beforeRecords = await f.records.listForBook(f.book.id)
  const changed = vi.fn()
  render(<ReadingCycleManager compact bookId={f.book.id} service={f.cycles} recordService={f.records} contentService={new ReadingContentService(f.repositories)} onReadingChanged={changed} />)
  const second = await screen.findByRole('region', { name: '第 2 次閱讀' })
  fireEvent.click(await within(second).findByRole('button', { name: '更新閱讀紀錄（1）' }))
  fireEvent.click(screen.getByRole('button', { name: '標記完讀' }))
  const dialog = screen.getByRole('dialog', { name: '第 2 次閱讀：標記完讀' })
  fireEvent.change(within(dialog).getByLabelText('完讀日期'), { target: { value: '2026-10-05' } })
  fireEvent.click(within(dialog).getByRole('button', { name: '確認完讀' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '第 2 次閱讀：標記完讀' })).toBeNull())
  const saved = await f.cycles.listForBook(f.book.id)
  expect(saved[0]).toEqual(beforeFirst)
  expect(saved[1]).toMatchObject({ id: f.second.id, status: 'completed', startedAt: f.second.startedAt, completionDate: { precision: 'date', completedOn: '2026-10-05' }, finishedAt: null })
  expect(await f.records.listForBook(f.book.id)).toEqual(beforeRecords)
  expect(changed).toHaveBeenCalledTimes(1)
  expect(within(second).getByText('已讀完')).toBeTruthy()
})

it('shows date-only start and last reading separately from completion without writing records', async () => {
  const f = await fixture()
  const cycle = { ...f.second, startedAt: null, startedOn: '2026-09-01', lastReadOn: '2026-10-04' }
  const before = await f.repositories.readingCycles.getAll()
  render(<BookReadingCycles bookId={f.book.id} cycles={[cycle]} records={[]} revision={0} recordService={f.records} onRecordsChanged={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />)
  const group = screen.getByRole('region', { name: '第 2 次閱讀' })
  expect(within(group).getByText('2026-09-01')).toBeTruthy()
  expect(within(group).getByText('最後閱讀日')).toBeTruthy()
  expect(within(group).getByText('2026-10-04').getAttribute('datetime')).toBe('2026-10-04')
  expect(within(group).getByText('尚未完讀')).toBeTruthy()
  expect(group.textContent).not.toContain('00:00')
  expect(await f.repositories.readingCycles.getAll()).toEqual(before)
})
