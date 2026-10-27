import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { backupCollections, backupJson, captureDeviceBackup, createStoredZip, prepareBackupArchive } from '../../src/features/backup/backup-export'
import { compareBackups, inspectBackup, validateBackup } from '../../src/features/backup/backup-preview'

async function fixture() {
  const repositories = createInMemoryRepositories()
  await new BookService(repositories, () => '11111111-1111-4111-8111-111111111111', () => '2026-10-13T00:00:00.000Z').create({ title: '合成預覽測試', mediaTypeId: 'ebook', bookNote: '' })
  return { repositories, backup: await captureDeviceBackup(repositories) }
}
it('accepts exported JSON and ZIP and keeps repositories untouched', async () => {
  const { repositories, backup } = await fixture()
  const writes = backupCollections.flatMap(key => [vi.spyOn(repositories[key], 'save'), vi.spyOn(repositories[key], 'delete'), vi.spyOn(repositories[key], 'clear')])
  const result = await inspectBackup(new Blob([backupJson(backup)]))
  expect(result.backup).toEqual(backup)
  const zip = await prepareBackupArchive(backup)
  expect((await inspectBackup(zip.blob)).backup).toEqual(backup)
  for (const write of writes) expect(write).not.toHaveBeenCalled()
})
it('rejects unsupported, incomplete, mismatched counts, duplicates and invalid dates', async () => {
  const { backup } = await fixture()
  for (const mutate of [
    (value: typeof backup) => { value.version = 2 as 1 },
    (value: typeof backup) => { value.schemaVersion++ },
    (value: typeof backup) => { value.counts.books++ },
    (value: typeof backup) => { value.data.books.push(value.data.books[0]); value.counts.books++ },
    (value: typeof backup) => { value.data.books[0].createdAt = '2026-02-30T00:00:00Z' },
    (value: typeof backup) => { delete (value.data as Partial<typeof value.data>).readingGoals },
  ]) {
    const changed = structuredClone(backup); mutate(changed)
    expect(() => validateBackup(changed)).toThrow()
  }
  await expect(inspectBackup(new Blob(['{"invalid"']))).rejects.toThrow('JSON')
})
it('verifies included covers and detects damaged ZIP bytes, missing covers and mismatched hashes', async () => {
  const { backup } = await fixture()
  const bytes = new TextEncoder().encode('synthetic cover')
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
  backup.data.books[0].cover = { path: `/api/v1/covers/covers/${backup.data.books[0].id}/${hash}-cover.png`, mimeType: 'image/png' }
  const zip = await prepareBackupArchive(backup, { fetch: vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'image/png' } })) })
  expect((await inspectBackup(zip.blob)).includedCovers).toBe(1)
  const damaged = new Uint8Array(await zip.blob.arrayBuffer()); damaged[80] ^= 1
  await expect(inspectBackup(new Blob([damaged]))).rejects.toThrow()
  const entries = [{ name: 'readingcenter-data.json', bytes: new TextEncoder().encode(backupJson(backup)) }, { name: 'covers-manifest.json', bytes: new TextEncoder().encode(JSON.stringify({ version: 1, assets: zip.assets })) }]
  await expect(inspectBackup(createStoredZip(entries))).rejects.toThrow('封面圖片')
  entries.push({ name: zip.assets[0].archivePath!, bytes: new TextEncoder().encode('wrong cover!!!!') })
  await expect(inspectBackup(createStoredZip(entries))).rejects.toThrow('封面圖片')
})
it('compares by ID and content ignoring object key order without assuming missing rows should be deleted', async () => {
  const { backup } = await fixture()
  const current = structuredClone(backup)
  current.data.books[0] = Object.fromEntries(Object.entries(current.data.books[0]).reverse()) as typeof current.data.books[0]
  expect(compareBackups(backup, current)[0]).toMatchObject({ same: 1, changed: 0, added: 0, currentOnly: 0 })
  current.data.books[0].bookNote = '目前資料'
  current.data.books.push({ ...current.data.books[0], id: 'current-only' })
  backup.data.books.push({ ...backup.data.books[0], id: 'incoming-only' })
  expect(compareBackups(backup, current)[0]).toMatchObject({ same: 0, changed: 1, added: 1, currentOnly: 1 })
})
it('warns about dangling book relationships while preserving evidence', async () => {
  const { backup } = await fixture()
  backup.data.readingCycles.push({ ...backup.data.books[0], id: 'cycle', bookId: 'missing', sequence: 1, status: 'planned', startedAt: null, finishedAt: null, abandonedReason: null })
  backup.counts.readingCycles = 1
  const result = await inspectBackup(new Blob([backupJson(backup)]))
  expect(result.warnings[0]).toContain('1 個')
  expect(result.backup.data.readingCycles[0].bookId).toBe('missing')
})
