// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BackupExport } from '../../src/features/backup/BackupExport'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })
it('offers a dated JSON download only after a successful read and invalidates it on option change', async () => {
  const create = vi.fn().mockReturnValue('blob:synthetic-backup')
  const revoke = vi.fn()
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const { unmount } = render(<BackupExport repositories={createInMemoryRepositories()} />)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.getByText('JSON 保留封面參照，不包含圖片檔。')).toBeTruthy()
  expect(screen.queryByRole('link', { name: '下載備份' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '準備資料 JSON' }))
  const link = await screen.findByRole('link', { name: '下載備份' })
  expect(link.getAttribute('download')).toMatch(/^readingcenter-device-.*\.json$/)
  expect(link.getAttribute('href')).toBe('blob:synthetic-backup')
  expect(create).toHaveBeenCalledOnce()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.queryByRole('link', { name: '下載備份' })).toBeNull()
  expect(revoke).toHaveBeenCalledWith('blob:synthetic-backup')
  unmount()
})
it('does not offer a download if any collection cannot be read', async () => {
  const repositories = createInMemoryRepositories()
  vi.spyOn(repositories.books, 'getAll').mockRejectedValue(new Error('無法讀取書庫'))
  render(<BackupExport repositories={repositories} />)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '準備資料 JSON' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('無法讀取書庫'))
  expect(screen.queryByRole('link', { name: '下載備份' })).toBeNull()
})
