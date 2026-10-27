import { describe, expect, it } from 'vitest'
import initSqlJs from 'sql.js'
import { parseMoonBackup } from '../../worker/moon-backup-parser'

const encoder = new TextEncoder()

function join(parts: Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let index = 0; index < 8; index++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function zipStored(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = encoder.encode(entry.name)
    const checksum = crc32(entry.data)
    const local = new Uint8Array(30 + name.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0x800, true)
    localView.setUint16(8, 0, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, entry.data.length, true)
    localView.setUint32(22, entry.data.length, true)
    localView.setUint16(26, name.length, true)
    local.set(name, 30)
    localParts.push(local, entry.data)

    const central = new Uint8Array(46 + name.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0x800, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, entry.data.length, true)
    centralView.setUint32(24, entry.data.length, true)
    centralView.setUint16(28, name.length, true)
    centralView.setUint32(42, localOffset, true)
    central.set(name, 46)
    centralParts.push(central)
    localOffset += local.length + entry.data.length
  }

  const localBytes = join(localParts)
  const centralBytes = join(centralParts)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralBytes.length, true)
  endView.setUint32(16, localBytes.length, true)
  return join([localBytes, centralBytes, end])
}

describe('parseMoonBackup', () => {
  it('parses the database and daily statistics from a Moon+ archive', async () => {
    const SQL = await initSqlJs()
    const database = new SQL.Database()
    database.run('CREATE TABLE books (book TEXT, author TEXT, filename TEXT, coverFile TEXT, thumbFile TEXT)')
    database.run('CREATE TABLE statistics (filename TEXT, usedTime INTEGER, readWords INTEGER, dates TEXT)')
    database.run("INSERT INTO books VALUES ('測試小說', '測試作者', '/books/test.epub', '/covers/test.png', '')")
    database.run("INSERT INTO statistics VALUES ('/books/test.epub', 6000, 50, '20733|6000@50 #75%')")
    const databaseBytes = database.export()
    database.close()

    const archive = zipStored([
      { name: 'backup/_names.list', data: encoder.encode('/books/test.epub\n/books/databases/mrbooks.db\n/covers/test.png\n') },
      { name: 'backup/1.tag', data: encoder.encode('book file') },
      { name: 'backup/2.tag', data: databaseBytes },
      { name: 'backup/3.tag', data: new Uint8Array([1, 2, 3]) }
    ])

    await expect(parseMoonBackup(archive)).resolves.toEqual({
      books: [{
        title: '測試小說',
        author: '測試作者',
        path: '/books/test.epub',
        coverPath: '/covers/test.png',
        coverCandidates: []
      }],
      statistics: [{
        path: '/books/test.epub',
        durationMs: 6000,
        readWords: 50,
        days: [{ dayCode: 20733, durationMs: 6000, readWords: 50, progressPercent: 75 }]
      }],
      unmatchedStatistics: []
    })
  })

  it('returns numbered alternate cover paths for visual review without selecting them automatically', async () => {
    const SQL = await initSqlJs()
    const database = new SQL.Database()
    database.run('CREATE TABLE books (book TEXT, author TEXT, filename TEXT, coverFile TEXT, thumbFile TEXT)')
    database.run('CREATE TABLE statistics (filename TEXT, usedTime INTEGER, readWords INTEGER, dates TEXT)')
    database.run("INSERT INTO books VALUES ('Review title', 'Review author', '/books/review.epub', '/covers/review_1.png', '')")
    const databaseBytes = database.export()
    database.close()
    const archive = zipStored([
      { name: 'backup/_names.list', data: encoder.encode('/books/review.epub\n/books/databases/mrbooks.db\n/covers/review_2.png\n') },
      { name: 'backup/1.tag', data: encoder.encode('book file') },
      { name: 'backup/2.tag', data: databaseBytes },
      { name: 'backup/3.tag', data: new Uint8Array([1, 2, 3]) }
    ])

    await expect(parseMoonBackup(archive)).resolves.toMatchObject({
      books: [{ coverPath: null, coverCandidates: ['/covers/review_2.png'] }]
    })
  })
})

