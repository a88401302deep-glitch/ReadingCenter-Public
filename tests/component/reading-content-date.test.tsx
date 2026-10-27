// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingNotes } from '../../src/features/library/ReadingNotes'
import { ReadingContentDate } from '../../src/features/reading-contents/ReadingContentDate'
import { ReadingContentManager } from '../../src/features/reading-contents/ReadingContentManager'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'

const now = '2026-10-02T03:00:00.000Z'
async function fixture(recordedForAt: string | null, imported = true, list = false, completion = false) {
  const repositories = createInMemoryRepositories()
  const book = await new BookService(repositories, () => 'book', () => now).create({ title: '書', mediaTypeId: 'ebook' })
  const service = new ReadingContentService(repositories, () => 'review', () => now)
  const content = await service.create(book.id, { type: 'shortReview', text: '歷史短評', recordedForAt })
  if (imported) {
    content.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: 'snapshot:2:short-review', importedAt: now }
    await repositories.readingContents.save(content)
  }
  if (completion) {
    const cycle = await new ReadingCycleService(repositories, () => 'cycle', () => now).create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2024-01-15' } })
    cycle.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: 'snapshot:2', importedAt: now }
    await repositories.readingCycles.save(cycle)
  }
  const cycles = await repositories.readingCycles.getAll()
  const result = render(list ? <ReadingNotes books={[book]} onChanged={() => {}} onOpenBook={() => {}} revision={0} service={service} /> : <ReadingContentManager bookId={book.id} cycles={cycles} service={service} />)
  await screen.findByText('歷史短評')
  return { ...result, repositories, content }
}

describe('reading content date semantics', () => {
  it('does not present the import timestamp as the original short-review date', async () => {
    const { container, repositories, content } = await fixture(null)
    expect(screen.getByText('完讀日期未確定')).toBeTruthy()
    expect(container.querySelector('time')).toBeNull()
    expect(await repositories.readingContents.getById(content.id)).toMatchObject({ recordedForAt: null, createdAt: now })
  })

  it('shows explicit content dates and preserves the exact instant when editing only text', async () => {
    const date = '2024-01-15T13:16:32.000Z'
    const { container, repositories, content } = await fixture(date)
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(date)
    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    const local = new Date(date)
    const expectedInput = new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    expect((screen.getByLabelText('內容時間') as HTMLInputElement).value).toBe(expectedInput)
    fireEvent.change(screen.getByLabelText('短評內容'), { target: { value: '修改短評' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(async () => expect(await repositories.readingContents.getById(content.id)).toMatchObject({ text: '修改短評', recordedForAt: date, createdAt: now }))
  })

  it('retains the creation date for direct manual entries without an explicit content date', async () => {
    const { container } = await fixture(null, false)
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(now)
    expect(screen.queryByText('完讀日期未確定')).toBeNull()
  })
})


describe('reading notes list dates', () => {
  it('labels imported reviews without source dates and preserves that after inline editing', async () => {
    const { container, repositories, content } = await fixture(null, true, true)
    expect(screen.getByText('完讀日期未確定')).toBeTruthy()
    expect(container.querySelector('time')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '編輯' }))
    fireEvent.change(screen.getByLabelText('內容'), { target: { value: '修改短評' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByText('修改短評')
    expect(screen.getByText('完讀日期未確定')).toBeTruthy()
    expect(await repositories.readingContents.getById(content.id)).toMatchObject({ recordedForAt: null, createdAt: now })
  })

  it.each([true, false])('shows the explicit content date for imported=%s', async (imported) => {
    const date = '2024-01-15T13:16:32.000Z'
    const { container } = await fixture(date, imported, true)
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(date)
    expect(screen.queryByText('完讀日期未確定')).toBeNull()
  })

  it('shows the creation date for untimed manual notes', async () => {
    const { container } = await fixture(null, false, true)
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(now)
  })
})


describe.each([false, true])('Notion short-review completion-date fallback (list=%s)', (list) => {
  it('shows the source completion date without changing review timestamps', async () => {
    const { container, repositories, content } = await fixture(null, true, list, true)
    expect(await screen.findByText('完讀日：')).toBeTruthy()
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2024-01-15')
    expect(await repositories.readingContents.getById(content.id)).toMatchObject({ recordedForAt: null, createdAt: now })
  })

  it('keeps explicit content dates ahead of the completion fallback', async () => {
    const date = '2024-02-15T13:16:32.000Z'
    const { container } = await fixture(date, true, list, true)
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe(date)
    expect(screen.queryByText('完讀日：')).toBeNull()
  })
})


describe('completion fallback matching and precision', () => {
  it('uses the matching source row among multiple cycles and does not pick an unrelated latest cycle', async () => {
    const { rerender, container, repositories, content } = await fixture(null, true, false, true)
    const [cycle] = await repositories.readingCycles.getAll()
    const other = { ...cycle, id: 'other', sequence: 2, provenance: { ...cycle.provenance, kind: 'import' as const, sourceId: 'notion-csv-snapshot', externalId: 'snapshot:3', importedAt: now }, completionDate: { precision: 'date' as const, completedOn: '2025-12-31' } }
    rerender(<ReadingContentDate content={content} cycles={[other, cycle]} />)
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2024-01-15')
    const unmatched = { ...content, provenance: { kind: 'import' as const, sourceId: 'notion-csv-snapshot', externalId: 'snapshot:4:short-review', importedAt: now } }
    rerender(<ReadingContentDate content={unmatched} cycles={[other, cycle]} />)
    expect(screen.getByText('完讀日期未確定')).toBeTruthy()
    expect(container.querySelector('time')).toBeNull()
  })

  it('preserves a source date range and excludes other books', async () => {
    const { rerender, repositories, content } = await fixture(null, true, false, true)
    const [cycle] = await repositories.readingCycles.getAll()
    const ranged = { ...cycle, completionDate: { precision: 'range' as const, startedOn: '2024-01-01', completedOn: '2024-01-15' } }
    rerender(<ReadingContentDate content={content} cycles={[ranged]} />)
    expect(screen.getByText('完讀日期範圍：2024-01-01－2024-01-15')).toBeTruthy()
    rerender(<ReadingContentDate content={content} cycles={[{ ...ranged, bookId: 'another-book' }]} />)
    expect(screen.getByText('完讀日期未確定')).toBeTruthy()
  })
})
