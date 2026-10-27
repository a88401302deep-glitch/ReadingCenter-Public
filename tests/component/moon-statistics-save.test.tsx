// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { MoonBackupPreview } from '../../src/features/import/MoonBackupPreview'
import { openMoonBackup } from '../../src/import/moon-backup-reader'
import { importMoonBackupBatch } from '../../src/import/moon-backup-batch-import'
import { createInMemoryRepositories } from '../../src/data'
vi.mock('../../src/import/moon-backup-reader', () => ({ openMoonBackup: vi.fn() }))
vi.mock('../../src/import/moon-backup-batch-import', () => ({ importMoonBackupBatch: vi.fn() }))

it('imports book and source statistics through one batch action and reports duplicate skips', async () => {
  const repositories = createInMemoryRepositories()
  const statistics = [{ path: '/unmatched.txt', durationMs: 1000, readWords: 10, days: [{ dayCode: 20697, durationMs: 1000, readWords: 10, progressPercent: 100 }] }]
  vi.mocked(openMoonBackup).mockResolvedValue({ books: [], statistics, unmatchedStatistics: statistics, readCover: vi.fn() })
  vi.mocked(importMoonBackupBatch).mockResolvedValue({ booksCreated: 0, booksMatched: 0, coversSaved: 0, coverWarnings: [], booksPending: 0, statistics: { imported: 1, skipped: 0 } })
  const user = userEvent.setup()
  render(<MoonBackupPreview repositories={repositories} />)
  await user.upload(screen.getByLabelText('選擇備份'), new File(['backup'], 'backup.mrpro'))
  await user.click(await screen.findByRole('button', { name: '匯入書目與統計' }))
  await waitFor(() => expect(screen.getByText(/新增每日統計 1 列/)).toBeTruthy())
  expect(importMoonBackupBatch).toHaveBeenCalledWith(repositories, [{ deviceId: 'BOOX TUCP', name: 'backup.mrpro', backup: { books: [], statistics, unmatchedStatistics: statistics, readCover: expect.any(Function) } }], new Set(), expect.any(String), { saveCover: expect.any(Function) })
  vi.mocked(importMoonBackupBatch).mockResolvedValue({ booksCreated: 0, booksMatched: 0, coversSaved: 0, coverWarnings: [], booksPending: 0, statistics: { imported: 0, skipped: 1 } })
  await user.click(screen.getByRole('button', { name: '匯入書目與統計' }))
  await waitFor(() => expect(screen.getByText(/跳過相同紀錄 1 列/)).toBeTruthy())
})

