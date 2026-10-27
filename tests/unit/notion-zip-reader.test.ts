/// <reference types="node" />
import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { openNotionZip } from '../../src/import/notion-zip-reader'

describe('Notion ZIP cover reader', () => {
  it('reads a UTF-8 CSV for cover-only source comparison without accepting it as an image', async () => {
    const csv = '書名,封面\n書籍,封面.jpg'
    const archive = zip('書籍.csv', new TextEncoder().encode(csv))
    const reader = await openNotionZip(new Blob([Uint8Array.from(archive)]))
    expect(await reader.readCsv('書籍.csv')).toBe(csv)
    await expect(reader.readImage('書籍.csv')).rejects.toThrow('missing')
    await expect(reader.readCsv('封面.jpg')).rejects.toThrow('not a CSV')
  })

  it('extracts one image by its encoded export name and verifies its checksum', async () => {
    const image = new TextEncoder().encode('test image bytes')
    const archive = zip('封面 1.jpg', image)
    const reader = await openNotionZip(new Blob([Uint8Array.from(archive)]))
    expect(reader.filenames).toEqual(['封面 1.jpg'])
    expect(await reader.readImage('%E5%B0%81%E9%9D%A2%201.jpg')).toEqual(image)
    await expect(reader.readImage('missing.jpg')).rejects.toThrow('missing')
    const damaged = archive.slice()
    damaged[damaged.length - 22 - 46 - new TextEncoder().encode('封面 1.jpg').length + 16] ^= 1
    await expect((await openNotionZip(new Blob([Uint8Array.from(damaged)]))).readImage('封面 1.jpg')).rejects.toThrow('checksum')
  })
})

function zip(name: string, original: Uint8Array): Uint8Array {
  const nameBytes = new TextEncoder().encode(name)
  const compressed = deflateRawSync(original)
  const crc = crc32(original)
  const local = new Uint8Array(30 + nameBytes.length + compressed.length)
  const localView = new DataView(local.buffer)
  localView.setUint32(0, 0x04034b50, true)
  localView.setUint16(4, 20, true)
  localView.setUint16(6, 0x0800, true)
  localView.setUint16(8, 8, true)
  localView.setUint32(14, crc, true)
  localView.setUint32(18, compressed.length, true)
  localView.setUint32(22, original.length, true)
  localView.setUint16(26, nameBytes.length, true)
  local.set(nameBytes, 30)
  local.set(compressed, 30 + nameBytes.length)
  const central = new Uint8Array(46 + nameBytes.length)
  const view = new DataView(central.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, 0x0800, true)
  view.setUint16(10, 8, true)
  view.setUint32(16, crc, true)
  view.setUint32(20, compressed.length, true)
  view.setUint32(24, original.length, true)
  view.setUint16(28, nameBytes.length, true)
  central.set(nameBytes, 46)
  const end = new Uint8Array(22)
  const footer = new DataView(end.buffer)
  footer.setUint32(0, 0x06054b50, true)
  footer.setUint16(8, 1, true)
  footer.setUint16(10, 1, true)
  footer.setUint32(12, central.length, true)
  footer.setUint32(16, local.length, true)
  const archive = new Uint8Array(local.length + central.length + end.length)
  archive.set(local)
  archive.set(central, local.length)
  archive.set(end, local.length + central.length)
  return archive
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let index = 0; index < 8; index++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}
