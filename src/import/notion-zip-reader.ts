/** Reads individual ZIP assets without loading or expanding the full archive. */
export async function openBinaryZip(file: Blob) {
  const tailStart = Math.max(0, file.size - 22 - 0xffff)
  const tail = new DataView(await file.slice(tailStart).arrayBuffer())
  let end = -1
  for (let offset = tail.byteLength - 22; offset >= 0; offset--) {
    if (tail.getUint32(offset, true) === 0x06054b50 && offset + 22 + tail.getUint16(offset + 20, true) === tail.byteLength) { end = offset; break }
  }
  if (end < 0 || tail.getUint16(end + 4, true) !== 0 || tail.getUint16(end + 6, true) !== 0 ||
    tail.getUint16(end + 8, true) !== tail.getUint16(end + 10, true)) throw new Error('ZIP directory is missing or spans multiple files')
  const count = tail.getUint16(end + 10, true)
  const size = tail.getUint32(end + 12, true)
  const start = tail.getUint32(end + 16, true)
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff || start + size > tailStart + end || size > 2 * 1024 * 1024) {
    throw new Error('ZIP directory is too large or uses an unsupported format')
  }
  const directory = new DataView(await file.slice(start, start + size).arrayBuffer())
  const names = new Map<string, { offset: number; compressed: number; expanded: number; method: number; crc: number }>()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let position = 0
  for (let index = 0; index < count; index++) {
    if (position + 46 > size || directory.getUint32(position, true) !== 0x02014b50) throw new Error('ZIP entry header is invalid')
    const flags = directory.getUint16(position + 8, true)
    const method = directory.getUint16(position + 10, true)
    const crc = directory.getUint32(position + 16, true)
    const compressed = directory.getUint32(position + 20, true)
    const expanded = directory.getUint32(position + 24, true)
    const nameLength = directory.getUint16(position + 28, true)
    const extraLength = directory.getUint16(position + 30, true)
    const commentLength = directory.getUint16(position + 32, true)
    const offset = directory.getUint32(position + 42, true)
    const next = position + 46 + nameLength + extraLength + commentLength
    if (next > size || flags & 1 || (method !== 0 && method !== 8) || compressed === 0xffffffff || expanded === 0xffffffff || offset === 0xffffffff) {
      throw new Error('ZIP entry is encrypted, truncated or unsupported')
    }
    const name = decoder.decode(new Uint8Array(directory.buffer, position + 46, nameLength))
    if (names.has(name)) throw new Error('ZIP contains a repeated filename')
    names.set(name, { offset, compressed, expanded, method, crc })
    position = next
  }
  if (position !== size) throw new Error('ZIP directory contains trailing data')

  const readEntry = async (name: string, maximumBytes: number): Promise<Uint8Array> => {
    const entry = names.get(name)
    if (!entry) throw new Error('File is missing from the ZIP')
    if (entry.expanded > maximumBytes) throw new Error('ZIP file exceeds the permitted size')
    const header = new DataView(await file.slice(entry.offset, entry.offset + 30).arrayBuffer())
    if (header.byteLength !== 30 || header.getUint32(0, true) !== 0x04034b50 || header.getUint16(8, true) !== entry.method) {
      throw new Error('ZIP image header does not match its directory')
    }
    const begin = entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true)
    if (begin + entry.compressed > start) throw new Error('ZIP image bytes are truncated')
    const compressed = file.slice(begin, begin + entry.compressed)
    const stream = entry.method === 0 ? compressed.stream() : compressed.stream().pipeThrough(new DecompressionStream('deflate-raw'))
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > maximumBytes || length > entry.expanded) throw new Error('ZIP image exceeds its declared size')
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    if (length !== entry.expanded) throw new Error('ZIP image has the wrong size')
    const image = new Uint8Array(length)
    let at = 0
    for (const chunk of chunks) { image.set(chunk, at); at += chunk.length }
    if (crc32(image) !== entry.crc) throw new Error('ZIP image checksum does not match')
    return image
  }
  return {
    filenames: [...names.keys()],
    readBinary(name: string, maximumBytes: number): Promise<Uint8Array> { return readEntry(name, maximumBytes) },
    async readCsv(name: string): Promise<string> {
      if (!/\.csv$/i.test(name)) throw new Error('ZIP file is not a CSV')
      return decoder.decode(await readEntry(name, 2 * 1024 * 1024))
    },
    async readImage(sourceName: string): Promise<Uint8Array> {
      const name = names.has(sourceName) ? sourceName : decodeURIComponent(sourceName)
      if (!/\.(jpe?g|png|webp|avif)$/i.test(name)) throw new Error('Cover file is missing from the ZIP')
      return readEntry(name, 10 * 1024 * 1024)
    }
  }
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value ^= byte
    for (let i = 0; i < 8; i++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0)
  }
  return (value ^ 0xffffffff) >>> 0
}


/** Preserve the Notion reader contract for existing import services and adapters. */
export async function openNotionZip(file: Blob) {
  const { filenames, readCsv, readImage } = await openBinaryZip(file)
  return { filenames, readCsv, readImage }
}
