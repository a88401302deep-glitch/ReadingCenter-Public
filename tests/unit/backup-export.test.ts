import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { backupCollections, backupJson, captureDeviceBackup, createStoredZip, prepareBackupArchive } from '../../src/features/backup/backup-export'

const bookId = '11111111-1111-4111-8111-111111111111'
const now = '2026-10-13T00:00:00.000Z'
async function fixture(path?: string) {
  const repositories = createInMemoryRepositories()
  await new BookService(repositories, () => bookId, () => now).create({ title: '合成備份測試', mediaTypeId: 'ebook', bookNote: '人工備註\n第二行', cover: path ? { path, mimeType: 'image/png' } : null })
  return repositories
}
function unzip(bytes: Uint8Array) {
  const result = spawnSync('python3', ['-c', "import sys,io,json,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode('utf-8') for n in z.namelist()},ensure_ascii=False))"], { input: bytes, encoding: 'utf8' })
  expect(result.status, result.stderr).toBe(0)
  return JSON.parse(result.stdout) as Record<string, string>
}

describe('device backup export', () => {
  it('reads every collection in one transaction and preserves raw data without writes', async () => {
    const repositories = await fixture()
    const transaction = vi.fn()
    repositories.transaction = async work => { transaction(); return work() }
    const saves = backupCollections.map(key => vi.spyOn(repositories[key], 'save'))
    const snapshot = await captureDeviceBackup(repositories, now)
    expect(transaction).toHaveBeenCalledOnce()
    expect(Object.keys(snapshot.data)).toEqual([...backupCollections])
    expect(snapshot.data.books[0]).toEqual((await repositories.books.getAll())[0])
    expect(snapshot.data.books[0].bookNote).toBe('人工備註\n第二行')
    expect(snapshot.counts.books).toBe(1)
    expect(JSON.parse(backupJson(snapshot))).toEqual(snapshot)
    for (const save of saves) expect(save).not.toHaveBeenCalled()
    snapshot.data.books[0].title = '修改匯出副本'
    expect((await repositories.books.getAll())[0].title).toBe('合成備份測試')
  })
  it('rejects an incomplete read instead of producing a partial snapshot', async () => {
    const repositories = await fixture()
    vi.spyOn(repositories.readingContents, 'getAll').mockRejectedValue(new Error('read failed'))
    await expect(captureDeviceBackup(repositories, now)).rejects.toThrow('read failed')
  })
  it('creates a standard ZIP with correct checksums and Unicode names', async () => {
    const blob = createStoredZip([{ name: '資料.json', bytes: new TextEncoder().encode('{"書名":"測試"}') }, { name: 'empty.txt', bytes: new Uint8Array() }])
    expect(unzip(new Uint8Array(await blob.arrayBuffer()))).toEqual({ '資料.json': '{"書名":"測試"}', 'empty.txt': '' })
    expect(() => createStoredZip([{ name: '../escape', bytes: new Uint8Array() }])).toThrow('Invalid ZIP')
  })
  it('packs one copy of a shared cover, checks content hash, and preserves external references without requests', async () => {
    const bytes = new TextEncoder().encode('synthetic image bytes')
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
    const path = `/api/v1/covers/covers/${bookId}/${hash}-test.png`
    const repositories = await fixture(path)
    const snapshot = await captureDeviceBackup(repositories, now)
    snapshot.data.books.push({ ...snapshot.data.books[0], id: 'second-book' }, { ...snapshot.data.books[0], id: 'external-book', cover: { path: 'https://example.invalid/cover.png', mimeType: 'image/png' } })
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(bytes, { headers: { 'Content-Type': 'image/png' } }))
    const result = await prepareBackupArchive(snapshot, { fetch: request })
    expect(request).toHaveBeenCalledOnce()
    expect(request.mock.calls[0][0]).toBe(path)
    const contents = unzip(new Uint8Array(await result.blob.arrayBuffer()))
    expect(JSON.parse(contents['readingcenter-data.json'])).toEqual(snapshot)
    const manifest = JSON.parse(contents['covers-manifest.json'])
    expect(manifest.assets).toEqual(result.assets)
    const included = result.assets.find(asset => asset.status === 'included')!
    expect(contents[included.archivePath!]).toBe('synthetic image bytes')
    expect(included.sha256).toBe(hash)
    expect(result.assets.filter(asset => asset.status === 'reference-only')).toHaveLength(1)
  })
  it('stops on failed, corrupt, empty or unexpectedly typed covers', async () => {
    const snapshot = await captureDeviceBackup(await fixture(`/api/v1/covers/covers/${bookId}/${'0'.repeat(64)}-test.png`), now)
    for (const response of [new Response('missing', { status: 404 }), new Response('login', { headers: { 'Content-Type': 'text/html' } }), new Response(new Uint8Array(), { headers: { 'Content-Type': 'image/png' } }), new Response('changed', { headers: { 'Content-Type': 'image/png' } })]) {
      await expect(prepareBackupArchive(snapshot, { fetch: vi.fn<typeof fetch>().mockResolvedValue(response) })).rejects.toThrow()
    }
  })
  it('honors cancellation before fetching covers', async () => {
    const snapshot = await captureDeviceBackup(await fixture(`/api/v1/covers/covers/${bookId}/${'0'.repeat(64)}-test.png`), now)
    const controller = new AbortController()
    controller.abort()
    const request = vi.fn<typeof fetch>()
    await expect(prepareBackupArchive(snapshot, { fetch: request, signal: controller.signal })).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })
})
