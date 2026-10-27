// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { captureDeviceBackup } from '../../src/features/backup/backup-export'
import { BackupRestore } from '../../src/features/backup/BackupRestore'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('keeps conflicts unselected and requires a before-restore download and confirmation; disposes its URL', async () => {
  const repositories = createInMemoryRepositories()
  await new BookService(repositories, () => 'book').create({ title: '核對測試', mediaTypeId: 'ebook', bookNote: '人工內容' })
  const current = await captureDeviceBackup(repositories), backup = structuredClone(current); backup.data.books[0].bookNote = '舊備註'
  const revoke = vi.fn(), create = vi.fn().mockReturnValue('blob:before-restore'); vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const save = vi.spyOn(repositories.books, 'save')
  const { unmount } = render(<BackupRestore repositories={repositories} current={current} verified={{ backup, warnings: [], includedCovers: 0, referenceCovers: 0, coverFiles: new Map() }} />)
  const choice = screen.getByLabelText('核對測試（書籍／內容不同）') as HTMLInputElement
  expect(choice.checked).toBe(false); expect((screen.getByRole('button', { name: '合併還原所選資料' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(choice)
  expect(screen.getByText('目前："人工內容"')).toBeTruthy(); expect(screen.getByText('備份："舊備註"')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '準備還原前資料備份' })); expect(create).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('link', { name: '下載還原前資料備份' })); fireEvent.click(screen.getByLabelText('已保存還原前備份，並核對所選資料的差異'))
  expect((screen.getByRole('button', { name: '合併還原所選資料' }) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: '合併還原所選資料' }))
  expect((await screen.findByRole('alert')).textContent).toContain('不支援完整交易'); expect(save).not.toHaveBeenCalled()
  unmount(); expect(revoke).toHaveBeenCalledWith('blob:before-restore')
})
