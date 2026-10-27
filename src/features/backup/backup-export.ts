import type { ReadingCenterRepositories } from '../../data/repository'
import { LOCAL_DATABASE_SCHEMA_VERSION } from '../../data/indexeddb/database'

export const backupCollections = ['books', 'readingCycles', 'readingRecords', 'sourceReadingDays', 'readingContents', 'dictionaries', 'collections', 'works', 'activityLogs', 'readingGoals', 'readingPreferences'] as const
export type BackupCollection = typeof backupCollections[number]
type BackupData = { [K in BackupCollection]: Awaited<ReturnType<ReadingCenterRepositories[K]['getAll']>> }
export interface DeviceBackup {
  format: 'readingcenter-device-backup'
  version: 1
  schemaVersion: number
  generatedAt: string
  scope: 'device-data'
  data: BackupData
  counts: Record<BackupCollection, number>
}

/** All repository reads finish inside one transaction; assets are downloaded afterwards. */
export async function captureDeviceBackup(repositories: ReadingCenterRepositories, now = new Date().toISOString()): Promise<DeviceBackup> {
  const read = async () => {
    const pairs = await Promise.all(backupCollections.map(async key => [key, await repositories[key].getAll()] as const))
    return structuredClone(Object.fromEntries(pairs)) as BackupData
  }
  const data = await (repositories.transaction ? repositories.transaction(read) : read())
  return { format: 'readingcenter-device-backup', version: 1, schemaVersion: LOCAL_DATABASE_SCHEMA_VERSION, generatedAt: now, scope: 'device-data', data,
    counts: Object.fromEntries(backupCollections.map(key => [key, data[key].length])) as Record<BackupCollection, number> }
}

export function backupJson(backup: DeviceBackup): string { return JSON.stringify(backup, null, 2) + '\n' }

export interface BackupAsset { sourcePath: string; archivePath: string | null; sha256: string | null; bytes: number | null; status: 'included' | 'reference-only' }
export interface ArchiveEntry { name: string; bytes: Uint8Array<ArrayBuffer> }
const encoder = new TextEncoder()
const maxAssetBytes = 10 * 1024 * 1024
const maxArchiveBytes = 128 * 1024 * 1024
const managedCoverPath = /^\/api\/v1\/covers\/covers\/(?:notion%3Abook%3A[0-9a-f]{64}%3A\d+|[0-9a-f-]{36})\/[0-9a-f]{64}-[^/?#]+\.(jpg|png|webp|avif)$/

export async function prepareBackupArchive(backup: DeviceBackup, options: { fetch?: typeof fetch; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<{ blob: Blob; assets: BackupAsset[] }> {
  const request = options.fetch ?? fetch
  const paths = [...new Set([...backup.data.books, ...backup.data.works].flatMap(item => item.cover ? [item.cover.path] : []))]
  const entries: ArchiveEntry[] = [{ name: 'readingcenter-data.json', bytes: encoder.encode(backupJson(backup)) }]
  const assets: BackupAsset[] = []
  let totalBytes = entries[0].bytes.length
  if (totalBytes > maxArchiveBytes || paths.length > 5000) throw new Error('備份超過目前打包大小限制，請先下載資料 JSON')
  for (const [index, path] of paths.entries()) {
    options.signal?.throwIfAborted()
    if (!managedCoverPath.test(path)) {
      assets.push({ sourcePath: path, archivePath: null, sha256: null, bytes: null, status: 'reference-only' })
    } else {
      const response = await request(path, { credentials: 'same-origin', redirect: 'error', signal: options.signal })
      const expectedMime = path.endsWith('.jpg') ? 'image/jpeg' : 'image/' + path.split('.').at(-1)
      if (!response.ok || response.headers.get('Content-Type')?.split(';')[0].trim() !== expectedMime) throw new Error('封面讀取失敗，未產生圖片備份；可改下載資料 JSON')
      const length = Number(response.headers.get('Content-Length'))
      if (length > maxAssetBytes || totalBytes + length > maxArchiveBytes) throw new Error('封面備份超過目前打包大小限制，請先下載資料 JSON')
      // Limit each response while reading; do not buffer an unbounded response.
      const reader = response.body?.getReader()
      if (!reader) throw new Error('封面內容無法讀取，未產生圖片備份')
      const parts: Uint8Array[] = []
      let size = 0
      try {
        for (;;) {
          options.signal?.throwIfAborted()
          const part = await reader.read()
          if (part.done) break
          size += part.value.byteLength
          if (size > maxAssetBytes || totalBytes + size > maxArchiveBytes) throw new Error('封面備份超過目前打包大小限制，請先下載資料 JSON')
          parts.push(part.value)
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
      if (!size) throw new Error('封面內容是空的，未產生圖片備份')
      const bytes = new Uint8Array(size)
      let position = 0
      for (const part of parts) { bytes.set(part, position); position += part.length }
      const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')
      const expectedHash = /\/([0-9a-f]{64})-[^/]+$/.exec(path)?.[1]
      if (sha256 !== expectedHash) throw new Error('封面校驗失敗，未產生圖片備份')
      const archivePath = `covers/${String(index + 1).padStart(5, '0')}-${sha256}.${path.split('.').at(-1)}`
      entries.push({ name: archivePath, bytes })
      assets.push({ sourcePath: path, archivePath, sha256, bytes: size, status: 'included' })
      totalBytes += size
    }
    options.onProgress?.(index + 1, paths.length)
  }
  options.signal?.throwIfAborted()
  entries.push({ name: 'covers-manifest.json', bytes: encoder.encode(JSON.stringify({ version: 1, assets }, null, 2) + '\n') })
  return { blob: createStoredZip(entries), assets }
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})
function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) value = (value >>> 8) ^ crcTable[(value ^ byte) & 0xff]
  return (value ^ 0xffffffff) >>> 0
}

/** ZIP STORE method avoids compressing already-compressed covers or adding a dependency. */
export function createStoredZip(entries: ArchiveEntry[]): Blob {
  if (entries.length > 65535) throw new Error('Too many ZIP entries')
  const pieces: BlobPart[] = []
  const central: Uint8Array<ArrayBuffer>[] = []
  const names = new Set<string>()
  let offset = 0
  for (const entry of entries) {
    if (!entry.name || entry.name.startsWith('/') || entry.name.split('/').some(part => part === '..') || names.has(entry.name)) throw new Error('Invalid ZIP entry name')
    names.add(entry.name)
    const name = encoder.encode(entry.name)
    if (name.length > 65535 || entry.bytes.length > 0xffffffff) throw new Error('ZIP entry is too large')
    const crc = crc32(entry.bytes)
    const local = new Uint8Array(30 + name.length)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true); view.setUint16(6, 0x0800, true)
    view.setUint16(12, 0x0021, true); view.setUint32(14, crc, true)
    view.setUint32(18, entry.bytes.length, true); view.setUint32(22, entry.bytes.length, true); view.setUint16(26, name.length, true)
    local.set(name, 30)
    pieces.push(local, entry.bytes)
    const record = new Uint8Array(46 + name.length)
    const recordView = new DataView(record.buffer)
    recordView.setUint32(0, 0x02014b50, true); recordView.setUint16(4, 20, true); recordView.setUint16(6, 20, true); recordView.setUint16(8, 0x0800, true)
    recordView.setUint16(14, 0x0021, true); recordView.setUint32(16, crc, true)
    recordView.setUint32(20, entry.bytes.length, true); recordView.setUint32(24, entry.bytes.length, true); recordView.setUint16(28, name.length, true)
    recordView.setUint32(42, offset, true); record.set(name, 46)
    central.push(record); offset += local.length + entry.bytes.length
    if (offset > 0xffffffff) throw new Error('ZIP archive is too large')
  }
  const directorySize = central.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const view = new DataView(end.buffer)
  view.setUint32(0, 0x06054b50, true); view.setUint16(8, entries.length, true); view.setUint16(10, entries.length, true)
  view.setUint32(12, directorySize, true); view.setUint32(16, offset, true)
  return new Blob([...pieces, ...central, end], { type: 'application/zip' })
}
