// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Header } from '../../src/shared/ui/Header'

describe('Header', () => {
  it('uses one navigation DOM and changes only active state', () => {
    const onNavigate = vi.fn()
    const { rerender } = render(<Header active="reading" onNavigate={onNavigate} />)

    expect(screen.getByRole('button', { name: '閱讀' }).getAttribute('aria-current')).toBe('page')
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    expect(onNavigate).toHaveBeenCalledWith('library')

    rerender(<Header active="library" onNavigate={onNavigate} />)
    expect(screen.getByRole('button', { name: '書庫' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getAllByRole('navigation')).toHaveLength(1)
  })
})

it('replaces the brand with real completed/total book counts and keeps named icon actions', async () => {
 const { createInMemoryRepositories } = await import('../../src/data')
 const { BookService } = await import('../../src/features/books/book-service')
 const { ReadingCycleService } = await import('../../src/features/reading-cycles/reading-cycle-service')
 const { ReadingOverviewService } = await import('../../src/features/reading-overview/reading-overview-service')
 const { HeaderReadingSummary } = await import('../../src/features/reading-overview/HeaderReadingSummary')
 const repo = createInMemoryRepositories(), books = new BookService(repo)
 const finished = await books.create({ title: '已讀', mediaTypeId: 'ebook' })
 await books.create({ title: '未讀', mediaTypeId: 'ebook' })
 await new ReadingCycleService(repo).create(finished.id, { status: 'completed', completionDate: { precision: 'date', completedOn: '2026-09-01' } })
 const logout = vi.fn(), navigate = vi.fn()
 render(<Header active="reading" onNavigate={navigate} onLogout={logout} summary={<HeaderReadingSummary service={new ReadingOverviewService(repo)} revision={0} />} />)
 expect(await screen.findByLabelText('累計讀完 1 本，書庫總數 2 本')).toBeTruthy()
 expect(screen.queryByText('閱讀中心')).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: '登出' })); expect(logout).toHaveBeenCalledOnce()
 fireEvent.click(screen.getByRole('button', { name: '管理' })); expect(navigate).toHaveBeenCalledWith('management')
 expect(await repo.readingCycles.getAll()).toHaveLength(1)
 expect(await repo.readingRecords.getAll()).toEqual([])
})
