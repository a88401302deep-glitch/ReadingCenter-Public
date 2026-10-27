// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { ReadingCenterRepositories } from '../../src/data'
import { App } from '../../src/app/App'
import { BookService } from '../../src/features/books/book-service'
import { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
const state = vi.hoisted(() => ({ repositories: undefined as ReadingCenterRepositories | undefined }))
vi.mock('../../src/data', async load => { const actual = await load<typeof import('../../src/data')>(); state.repositories = actual.createInMemoryRepositories(); return { ...actual, createIndexedDbRepositories: () => ({ repositories: state.repositories }) } })
vi.mock('../../src/features/auth/auth-context', () => ({ useAuth: () => ({ authEnabled: false, logout: vi.fn() }) }))
it('removes statistics and preference navigation without deleting books, records or goals', async () => {
 const repos = state.repositories!, book = await new BookService(repos).create({ title: '保留閱讀資料', mediaTypeId:'ebook' })
 await new ReadingRecordService(repos).create(book.id,{ startedAt:new Date().toISOString(),durationMinutes:30 })
 const goal = await new ReadingOverviewService(repos).saveGoal('2026-10',600,0)
 render(<App />)
 await waitFor(()=>expect(screen.getByRole('region',{name:'最近閱讀'}).textContent).toContain('保留閱讀資料'))
 expect(screen.queryByRole('link',{name:'閱讀中心首頁'})).toBeNull()
 expect(screen.queryByRole('button',{name:'統計'})).toBeNull()
 fireEvent.click(screen.getByRole('button',{name:'管理'}))
 expect(screen.getByRole('button',{name:'備份資料庫'})).toBeTruthy()
 expect(screen.getByRole('button',{name:'匯入資料庫'})).toBeTruthy()
 expect(screen.queryByRole('button',{name:'偏好設定'})).toBeNull()
 expect(screen.queryByRole('button',{name:'資料整理'})).toBeNull()
 expect(await repos.readingGoals.getById(goal.id)).toEqual(goal)
 expect(await repos.books.getById(book.id)).toEqual(book)
 expect(await repos.readingRecords.getAll()).toHaveLength(1)
})
