// @vitest-environment jsdom
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { ReadingCycleManager } from '../../src/features/reading-cycles/ReadingCycleManager'
import type { ReadingCycleService } from '../../src/features/reading-cycles/reading-cycle-service'
import type { ReadingRecordService } from '../../src/features/reading-records/reading-record-service'
import type { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'
vi.mock('../../src/features/reading-records/ReadingRecordPopover', () => ({ ReadingRecordPopover: () => null }))
vi.mock('../../src/features/reading-contents/ReadingContentManager', () => ({ ReadingContentManager: () => null }))
afterEach(cleanup)
for (const changeDate of [false, true]) it(changeDate ? 'updates a date-only completion without fabricating a timestamp or adding a cycle' : 'preserves a date-only completion when editing other fields', async () => {
  const update = vi.fn().mockResolvedValue(undefined), create = vi.fn()
  const service = { listForBook: vi.fn().mockResolvedValue([{ id: 'cycle', bookId: 'book', revision: 2, sequence: 1, status: 'completed', startedAt: null, finishedAt: null, completionDate: { precision: 'date', completedOn: '2026-07-01' }, reportedReadingDays: 10, abandonedReason: null }]), update, create } as unknown as ReadingCycleService
  render(<ReadingCycleManager bookId="book" service={service} recordService={{} as ReadingRecordService} contentService={{} as ReadingContentService} />)
  const user = userEvent.setup()
  await user.click(await screen.findByRole('button', { name: '編輯' }))
  expect(screen.getByLabelText('完讀日期').getAttribute('type')).toBe('date')
  if (changeDate) await user.clear(screen.getByLabelText('完讀日期')).then(() => user.type(screen.getByLabelText('完讀日期'), '2026-07-10'))
  await user.click(screen.getByRole('button', { name: '儲存' }))
  await waitFor(() => expect(update).toHaveBeenCalledWith('cycle', expect.objectContaining({ completionDate: { precision: 'date', completedOn: changeDate ? '2026-07-10' : '2026-07-01' }, startedAt: null, finishedAt: null, reportedReadingDays: 10 }), 2))
  expect(create).not.toHaveBeenCalled()
})
