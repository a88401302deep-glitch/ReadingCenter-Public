// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { MoonBackupPreview } from '../../src/features/import/MoonBackupPreview'
import { openMoonBackup } from '../../src/import/moon-backup-reader'
import { importMoonBackupBatch } from '../../src/import/moon-backup-batch-import'
vi.mock('../../src/import/moon-backup-reader', () => ({ openMoonBackup: vi.fn() }))
vi.mock('../../src/import/moon-backup-batch-import', () => ({ importMoonBackupBatch: vi.fn() }))
it('previews device totals, deduplicates a repeated backup, and can remove it without an import action', async () => {
  const statistics = [{ path: '/example.epub', durationMs: 3600000, readWords: 100, days: [{ dayCode: 123, durationMs: 3600000, readWords: 100, progressPercent: 100 }] }]
  vi.mocked(openMoonBackup).mockResolvedValue({ books: [{ path: '/example.epub', title: 'Example', author: 'Author', coverPath: null }], statistics, unmatchedStatistics: [], readCover: vi.fn() })
  const user = userEvent.setup()
  render(<MoonBackupPreview />)
  await user.selectOptions(screen.getByLabelText('來源裝置'), 'BIGME B7PRO')
  const input = screen.getByLabelText('選擇備份'), file = new File(['backup'], 'example.mrpro')
  await user.upload(input, file)
  await waitFor(() => expect(screen.getByText(/時數 1.00 小時/)).toBeTruthy())
  expect(screen.getByText('Example')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '確認匯入' })).toBeNull()
  await user.upload(input, file)
  await waitFor(() => expect(screen.getByText(/已去重 1 列/)).toBeTruthy())
  expect(screen.getByText(/時數 1.00 小時/)).toBeTruthy()
  await user.click(screen.getAllByRole('button', { name: '移除此預覽' })[0])
  await waitFor(() => expect(screen.getByText(/已去重 0 列/)).toBeTruthy())
})
it('shows renamed-format candidates, converted dates and a disputed completion marker without changing totals', async () => {
  const statistics = [{ path: '/old/Author《Example》.txt', durationMs: 3600000, readWords: 100, days: [{ dayCode: 20667, durationMs: 3600000, readWords: 100, progressPercent: 100 }] }]
  vi.mocked(openMoonBackup).mockResolvedValue({ books: [{ path: '/new/Author《Example》.epub', title: 'Example', author: 'Author', coverPath: null }], statistics, unmatchedStatistics: statistics, readCover: vi.fn() })
  const user = userEvent.setup()
  render(<MoonBackupPreview />)
  await user.upload(screen.getByLabelText('選擇備份'), new File(['backup'], 'example.mrpro'))
  await user.click(await screen.findByText('逐書閱讀統計與每日原值'))
  await user.click(screen.getByText(/Example · 1.00 小時 · 100 字/))
  expect(screen.getByText(/2026-08-03 · 日碼 20667/)).toBeTruthy()
  expect(screen.getByText(/Example · Author · 同書名/)).toBeTruthy()
  expect(screen.getByText(/100%（來源完讀）/)).toBeTruthy()
  await user.click(screen.getByLabelText('完讀紀錄有疑義'))
  expect(screen.getByText(/100%（有疑義，待核對）/)).toBeTruthy()
  expect(screen.getByText(/時數 1.00 小時/)).toBeTruthy()
})

it('keeps an unpaired cover candidate unselected until the user confirms it in the preview', async () => {
  const statistics = [{ path: '/books/review.epub', durationMs: 60000, readWords: 1, days: [{ dayCode: 123, durationMs: 60000, readWords: 1, progressPercent: 50 }] }]
  vi.mocked(openMoonBackup).mockResolvedValue({
    books: [{ path: '/books/review.epub', title: 'Review title', author: 'Review author', coverPath: null, coverCandidates: ['/covers/review_2.png'] }],
    statistics, unmatchedStatistics: [], readCover: vi.fn().mockResolvedValue(new Blob(['image'], { type: 'image/png' }))
  })
  const user = userEvent.setup()
  vi.mocked(importMoonBackupBatch).mockResolvedValue({ booksCreated: 0, booksMatched: 1, booksPending: 0, coversSaved: 1, coverWarnings: [], statistics: { imported: 0, skipped: 0 } })
  const repositories = { sourceReadingDays: { getAll: vi.fn().mockResolvedValue([]) } }
  render(<MoonBackupPreview repositories={repositories as never} />)
  await user.upload(screen.getByLabelText('選擇備份'), new File(['backup'], 'example.mrpro'))
  const select = await screen.findByRole('button', { name: /選用候選封面：review_2\.png/ })
  expect(select.getAttribute('aria-pressed')).toBe('false')
  expect(screen.getByText(/原引用圖片缺少/)).toBeTruthy()
  await user.click(select)
  expect(select.getAttribute('aria-pressed')).toBe('true')
  await user.click(screen.getByRole('button', { name: '匯入書目與統計' }))
  await waitFor(() => expect(importMoonBackupBatch).toHaveBeenCalled())
  expect(vi.mocked(importMoonBackupBatch).mock.calls[0][1][0].backup.books[0].coverPath).toBe('/covers/review_2.png')
})

