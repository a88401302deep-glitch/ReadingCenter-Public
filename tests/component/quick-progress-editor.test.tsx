// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { AuthContext } from '../../src/features/auth/auth-context'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { QuickProgressService } from '../../src/features/reading-overview/quick-progress-service'
import { QuickProgressEditor } from '../../src/features/reading-overview/QuickProgressEditor'
import { ReadingDashboard } from '../../src/features/reading-overview/ReadingDashboard'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
afterEach(() => vi.restoreAllMocks())
async function setup() {
  const repos = createInMemoryRepositories()
  const book = await new BookService(repos).create({ title: '快捷進度', mediaTypeId: 'ebook' })
  const cycle = await new ReadingCycleService(repos).create(book.id, { status: 'reading' })
  await new ReadingRecordService(repos).create(book.id, { cycleId: cycle.id, startedAt: '2026-10-01T00:00:00.000Z', progress: { unit: 'percent', value: 20 } })
  return { repos, book, cycle, service: new QuickProgressService(repos) }
}
it('opens progress separately from the cover without writing on open', async () => {
  const { repos, service } = await setup(), open = vi.fn()
  render(<ReadingDashboard service={new ReadingOverviewService(repos)} revision={0} onOpenBook={open} progressService={service} />)
  const trigger = await screen.findByRole('button', { name: '更新《快捷進度》進度' })
 trigger.blur()
 fireEvent.click(trigger)
  expect(await screen.findByRole('dialog', { name: '更新閱讀進度' })).toBeTruthy()
  expect(screen.queryByRole('dialog', { name: '《快捷進度》封面預覽' })).toBeNull()
  expect(open).not.toHaveBeenCalled()
  expect(await repos.readingRecords.getAll()).toHaveLength(1)
})
it('blocks duplicate submits and closing while saving without adding duration or completion', async () => {
  const { repos, book, cycle, service } = await setup()
  let finish!: () => void
  const gate = new Promise<void>(resolve => { finish = resolve }), actual = service.save.bind(service)
  const save = vi.spyOn(service, 'save').mockImplementation(async (...args) => { await gate; return actual(...args) })
  const closed = vi.fn(), saved = vi.fn()
  render(<QuickProgressEditor book={book} service={service} onClose={closed} onSaved={saved} />)
  const value = await screen.findByRole('spinbutton', { name: '目前進度' })
  fireEvent.change(value, { target: { value: '100' } })
  const form = document.querySelector('.quick-progress-form')!
  fireEvent.submit(form); fireEvent.submit(form); fireEvent.keyDown(document, { key: 'Escape' })
  expect(save).toHaveBeenCalledTimes(1); expect(closed).not.toHaveBeenCalled()
  finish()
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  const records = await repos.readingRecords.getAll()
  expect(records).toHaveLength(2)
  expect(records[1]).toMatchObject({ progress: { unit: 'percent', value: 100 }, durationMinutes: null, endedAt: null })
  expect(await repos.readingCycles.getById(cycle.id)).toEqual(cycle)
})
it('clears the draft when changing units and saves a page total explicitly', async () => {
  const { repos, book, service } = await setup(), saved = vi.fn()
  render(<QuickProgressEditor book={book} service={service} onClose={vi.fn()} onSaved={saved} />)
  const value = await screen.findByRole('spinbutton', { name: '目前進度' })
  fireEvent.change(screen.getByLabelText('進度單位'), { target: { value: 'page' } })
  expect(value).toHaveProperty('value', '')
  fireEvent.change(value, { target: { value: '40' } })
  fireEvent.change(screen.getByLabelText('進度總數'), { target: { value: '200' } })
  fireEvent.click(screen.getByRole('button', { name: '儲存進度' }))
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1))
  expect((await repos.readingRecords.getAll())[1].progress).toEqual({ unit: 'page', value: 40, total: 200 })
})
it('keeps conflicted drafts and confirms before discarding', async () => {
  const { repos, book, service } = await setup(), closed = vi.fn()
  render(<QuickProgressEditor book={book} service={service} onClose={closed} onSaved={vi.fn()} />)
  const value = await screen.findByRole('spinbutton', { name: '目前進度' })
  fireEvent.change(value, { target: { value: '45' } })
  await new ReadingRecordService(repos).create(book.id, { startedAt: '2026-10-02T00:00:00.000Z', progress: { unit: 'percent', value: 30 } })
  fireEvent.click(screen.getByRole('button', { name: '儲存進度' }))
  expect((await screen.findByRole('alert')).textContent).toContain('已有變更')
  expect(value).toHaveProperty('value', '45')
  expect(await repos.readingRecords.getAll()).toHaveLength(2)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  fireEvent.click(screen.getByRole('button', { name: '取消' })); expect(closed).not.toHaveBeenCalled()
  confirm.mockReturnValue(true); fireEvent.keyDown(document, { key: 'Escape' })
  expect(closed).toHaveBeenCalledTimes(1)
})
it('blocks writes in the read-only preview even for a valid draft', async () => {
  const { book, service } = await setup(), save = vi.spyOn(service, 'save')
  render(<AuthContext.Provider value={{ authEnabled: false, logout: async () => {}, previewReadOnly: true }}><QuickProgressEditor book={book} service={service} onClose={vi.fn()} onSaved={vi.fn()} /></AuthContext.Provider>)
  fireEvent.change(await screen.findByRole('spinbutton', { name: '目前進度' }), { target: { value: '50' } })
  expect(screen.getByRole('button', { name: '此預覽不儲存' })).toHaveProperty('disabled', true)
  fireEvent.submit(document.querySelector('.quick-progress-form')!)
  expect(save).not.toHaveBeenCalled()
})
