// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BackupPreview } from '../../src/features/backup/BackupPreview'
import { backupCollections, backupJson, captureDeviceBackup } from '../../src/features/backup/backup-export'
afterEach(cleanup)
it('shows comparison without any restore action or repository writes and clears a previous preview on invalid selection', async () => {
  const repositories = createInMemoryRepositories()
  const backup = await captureDeviceBackup(repositories)
  const writes = backupCollections.map(key => vi.spyOn(repositories[key], 'save'))
  render(<BackupPreview repositories={repositories} />)
  const file = new File([], 'backup.json')
  Object.defineProperty(file, 'size', { value: backupJson(backup).length })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(backupJson(backup)).buffer })
  fireEvent.change(screen.getByLabelText('選擇閱讀中心備份'), { target: { files: [file] } })
  expect(await screen.findByText('備份檔驗證完成，尚未還原。')).toBeTruthy()
  expect(screen.getByRole('table')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '合併還原所選資料' })).toBeNull()
  for (const write of writes) expect(write).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('選擇閱讀中心備份'), { target: { files: [new File([], 'bad.json')] } })
  expect(await screen.findByRole('alert')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})
