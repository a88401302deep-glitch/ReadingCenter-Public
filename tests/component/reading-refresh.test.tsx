// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { ReadingOverviewCard } from '../../src/features/reading-overview/ReadingOverviewCard'
import { BookProgress } from '../../src/shared/ui/BookProgress'
import { BookCover } from '../../src/shared/ui/BookCover'

it('uses real annual completions, saves only the target, and preserves an existing duration target', async () => {
  const repositories = createInMemoryRepositories()
  const books = new BookService(repositories, () => crypto.randomUUID())
  const cycles = new ReadingCycleService(repositories)
  for (const title of ['第一本', '第二本']) {
    const book = await books.create({ title, mediaTypeId: 'ebook' })
    await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-10-02' } })
  }
  const service = new ReadingOverviewService(repositories, () => new Date('2026-10-04'))
  await service.saveGoal('2026', 600, 0)
  const before = await repositories.readingCycles.getAll()
  const onChanged = vi.fn(async () => {})
  const { rerender } = render(<ReadingOverviewCard overview={await service.getOverview()} service={service} onChanged={onChanged} />)
  expect(screen.getByRole('progressbar', { name: '年度完讀進度' }).getAttribute('value')).toBe('2')
  expect(screen.getByRole('progressbar', { name: '年度完讀進度' }).getAttribute('max')).toBe('70')
  fireEvent.click(screen.getByRole('button', { name: '調整目標' }))
  const editor = within(screen.getByRole('dialog', { name: '年度完讀目標' }))
  fireEvent.change(editor.getByRole('spinbutton', { name: '年度目標本數' }), { target: { value: '3' } })
  fireEvent.click(editor.getByRole('button', { name: '儲存目標' }))
  await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
  rerender(<ReadingOverviewCard overview={await service.getOverview()} service={service} onChanged={onChanged} />)
  expect(screen.getByText('67%')).toBeTruthy()
  expect(await repositories.readingGoals.getById('reading-goal:2026')).toMatchObject({ targetBooks: 3, targetMinutes: 600 })
  expect(await repositories.readingCycles.getAll()).toEqual(before)
})

it('shows chapter percentages only with a known total and distinguishes zero from missing progress', () => {
  const { rerender } = render(<BookProgress progress={{ unit: 'chapter', value: 25, total: 100, label: null }} />)
  expect(screen.getByText('25%')).toBeTruthy()
  rerender(<BookProgress progress={{ unit: 'chapter', value: 25, total: null, label: null }} />)
  expect(screen.getByRole('progressbar').getAttribute('value')).toBe('0')
  expect(screen.queryByText('25%')).toBeNull()
  rerender(<BookProgress progress={{ unit: 'percent', value: 0 }} />)
  expect(screen.getByText('0%')).toBeTruthy()
  rerender(<BookProgress progress={null} />)
  expect(screen.getByText('閱讀中')).toBeTruthy()
})

it('uses a text cover for missing or broken images and retries a newly selected image', () => {
  const { rerender } = render(<BookCover title="米色文字封面" src="https://example.com/broken.jpg" />)
  fireEvent.error(screen.getByRole('img'))
  expect(screen.getByRole('img', { name: '米色文字封面無封面' }).className).toContain('book-cover--fallback')
  rerender(<BookCover title="米色文字封面" src="https://example.com/new.jpg" />)
  expect(screen.getByRole('img').getAttribute('src')).toBe('https://example.com/new.jpg')
})
