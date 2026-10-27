import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { expect, it, vi } from 'vitest'
import { openMoonBackup } from '../../src/import/moon-backup-reader'

// Use the real SQLite engine with local WASM; browser builds use Vite's asset URL.
vi.mock('sql.js', async importOriginal => {
  const actual = await importOriginal<typeof import('sql.js')>()
  const require = createRequire(import.meta.url)
  return { default: () => actual.default({ wasmBinary: readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')) }) }
})
function zip(entries: [string, Uint8Array][]): Blob {
  const local: Uint8Array[] = [], central: Uint8Array[] = []
  let offset = 0
  for (const [name, bytes] of entries) {
    const filename = new TextEncoder().encode(name)
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const header = new Uint8Array(30 + filename.length), h = new DataView(header.buffer)
    h.setUint32(0, 0x04034b50, true); h.setUint32(14, crc, true)
    h.setUint32(18, bytes.length, true); h.setUint32(22, bytes.length, true)
    h.setUint16(26, filename.length, true); header.set(filename, 30)
    local.push(header, bytes)
    const dir = new Uint8Array(46 + filename.length), d = new DataView(dir.buffer)
    d.setUint32(0, 0x02014b50, true); d.setUint32(16, crc, true)
    d.setUint32(20, bytes.length, true); d.setUint32(24, bytes.length, true)
    d.setUint16(28, filename.length, true); d.setUint32(42, offset, true); dir.set(filename, 46)
    central.push(dir); offset += header.length + bytes.length
  }
  const end = new Uint8Array(22), e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true)
  e.setUint32(12, central.reduce((sum, bytes) => sum + bytes.length, 0), true); e.setUint32(16, offset, true)
  return new Blob([...local, ...central, end].map(bytes => new Uint8Array(bytes)))
}
async function fixture(inconsistent = false, differentCover = false) {
  const { default: init } = await import('sql.js')
  const SQL = await init(), db = new SQL.Database()
  try {
    db.run('CREATE TABLE books (book TEXT, author TEXT, filename TEXT, coverFile TEXT, thumbFile TEXT); CREATE TABLE statistics (filename TEXT, usedTime INTEGER, readWords INTEGER, dates TEXT)')
    db.run('INSERT INTO books VALUES (?, ?, ?, ?, ?)', ['Example', 'Author', '/books/example.epub', '/covers/a.png', ''])
    db.run('INSERT INTO statistics VALUES (?, ?, ?, ?)', ['/removed/example.epub', inconsistent ? 1001 : 1000, 10, '123|1000@10 #100%'])
    const encode = (value: string) => new TextEncoder().encode(value)
    return zip([['nested/_names.list', encode('/settings/ignored\n*/covers/a.png\n/app/databases/mrbooks.db\n*/covers/a.png\n')], ['nested/1.tag', encode('unused')], ['nested/2.tag', encode('image')], ['nested/3.tag', db.export()], ['nested/4.tag', encode(differentCover ? 'different' : 'image')]])
  } finally { db.close() }
}
it('resolves the numbered database and starred cover paths, retaining unmatched statistics', async () => {
  const result = await openMoonBackup(await fixture())
  expect(result.books).toEqual([{ title: 'Example', author: 'Author', path: '/books/example.epub', coverPath: '/covers/a.png', coverCandidates: [] }])
  expect(result.unmatchedStatistics).toHaveLength(1)
  expect(result.statistics[0].days[0]).toMatchObject({ dayCode: 123, durationMs: 1000, progressPercent: 100 })
  await expect(result.readCover('/missing.png')).rejects.toThrow('找不到封面圖片')
})
it('rejects inconsistent daily and cumulative totals', async () => {
  await expect(openMoonBackup(await fixture(true))).rejects.toThrow('逐書累計與每日明細不一致')
})
it('rejects a ZIP without the source manifest', async () => {
  await expect(openMoonBackup(zip([['file.txt', new Uint8Array([1])]]))).rejects.toThrow('找不到唯一')
})

it('rejects differing images mapped to the same source path', async () => {
  await expect(openMoonBackup(await fixture(false, true))).rejects.toThrow('同一路徑有不同封面')
})
