// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { CompleteReadingDialog } from '../../src/features/reading-cycles/CompleteReadingDialog'

async function fixture() {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories).create({ title: '完讀', mediaTypeId: 'ebook' })
  const service = new ReadingCycleService(repositories)
  const cycle = await service.create(book.id, { status: 'reading', reportedDurationMinutes: 90, reportedReadingDays: 3 })
  return { repositories, book, service, cycle }
}
it('allows an unknown completion date and preserves cumulative values without making a record', async () => {
  const f = await fixture()
  const saved = vi.fn(), closed = vi.fn()
  render(<CompleteReadingDialog cycle={f.cycle} service={f.service} onSaved={saved} onClose={closed} />)
  fireEvent.click(screen.getByRole('button', { name: '確認完讀' }))
  await waitFor(() => expect(closed).toHaveBeenCalledOnce())
  expect((await f.service.listForBook(f.book.id))[0]).toMatchObject({ status: 'completed', completionDate: null, finishedAt: null, reportedDurationMinutes: 90, reportedReadingDays: 3 })
  expect(await f.repositories.readingRecords.getAll()).toEqual([])
  expect(saved).toHaveBeenCalledOnce()
})
it('cancels without changing reading facts', async () => {
  const f = await fixture()
  const saved = vi.fn(), closed = vi.fn()
  render(<CompleteReadingDialog cycle={f.cycle} service={f.service} onSaved={saved} onClose={closed} />)
  fireEvent.change(screen.getByLabelText('完讀日期'), { target: { value: '2026-10-05' } })
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(closed).toHaveBeenCalledOnce()
  expect(saved).not.toHaveBeenCalled()
  expect((await f.service.listForBook(f.book.id))[0]).toEqual(f.cycle)
})
it('keeps the dialog and date on a revision conflict without overwriting newer facts', async () => {
  const f = await fixture()
  const latest = await f.service.update(f.cycle.id, { status: 'paused', reportedDurationMinutes: 120 }, f.cycle.revision)
  const saved = vi.fn(), closed = vi.fn()
  render(<CompleteReadingDialog cycle={f.cycle} service={f.service} onSaved={saved} onClose={closed} />)
  fireEvent.change(screen.getByLabelText('完讀日期'), { target: { value: '2026-10-05' } })
  fireEvent.click(screen.getByRole('button', { name: '確認完讀' }))
  await screen.findByText('資料已有新版本；草稿已保留，請核對最新內容後再儲存')
  expect((screen.getByLabelText('完讀日期') as HTMLInputElement).value).toBe('2026-10-05')
  expect((await f.service.listForBook(f.book.id))[0]).toEqual(latest)
  expect(saved).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
})
