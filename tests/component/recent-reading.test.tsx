// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingDashboard } from '../../src/features/reading-overview/ReadingDashboard'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
it('shows the ten latest books with full completion progress without creating artificial records', async () => {
 const repos = createInMemoryRepositories(), books = new BookService(repos), cycles = new ReadingCycleService(repos)
 for (let day = 1; day <= 12; day++) { const book = await books.create({ title: `完讀 ${day}`, mediaTypeId: 'ebook' }); await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: `2026-09-${String(day).padStart(2,'0')}` } }) }
 const open = vi.fn(); render(<ReadingDashboard service={new ReadingOverviewService(repos)} revision={0} onOpenBook={open} />)
 const recent = within(screen.getByRole('region', { name: '最近閱讀' }))
 const newest = await recent.findByRole('button', { name: '放大《完讀 12》封面' })
 expect(recent.getAllByRole('listitem')).toHaveLength(10)
 expect(recent.getAllByRole('progressbar').every(n=>n.getAttribute('value') === '100')).toBe(true)
 expect(recent.queryByText('進度未記錄')).toBeNull()
 expect(recent.queryByText('100%')).toBeNull()
 newest.focus()
 fireEvent.click(newest)
 expect(screen.getByRole('dialog', { name: '《完讀 12》封面預覽' })).toBeTruthy()
 expect(screen.getAllByRole('button', { name: '關閉封面預覽' })).toHaveLength(1)
 expect(screen.queryByRole('button', { name: '前往書籍資料' })).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: '關閉封面預覽' }))
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(document.activeElement).toBe(newest)
 expect(open).not.toHaveBeenCalled()
 expect(await repos.readingRecords.getAll()).toHaveLength(0)
 expect(screen.queryByRole('region', { name: '閱讀統計與月曆' })).toBeNull()
})
it('uses the current reading cycle for a reread even if an older cycle completed', async () => {
 const repos = createInMemoryRepositories(), books = new BookService(repos), cycles = new ReadingCycleService(repos)
 const book = await books.create({ title: '重新閱讀', mediaTypeId: 'ebook' })
 await cycles.create(book.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-09-01' } })
 await cycles.create(book.id, { status: 'reading', startedAt: '2026-10-01T00:00:00Z' })
 await new ReadingRecordService(repos).create(book.id, { startedAt: '2026-10-02T00:00:00Z', progress: { unit: 'percent', value: 25 } })
 render(<ReadingDashboard service={new ReadingOverviewService(repos)} revision={0} onOpenBook={vi.fn()} />)
 const recent = within(screen.getByRole('region', { name: '最近閱讀' })); await recent.findByRole('button', { name: '放大《重新閱讀》封面' })
 expect(recent.getByRole('progressbar').getAttribute('value')).toBe('25')
})
