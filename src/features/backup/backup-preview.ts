import { LOCAL_DATABASE_SCHEMA_VERSION } from '../../data/indexeddb/database'
import { assertIsoDateTime, type EntityMetadata } from '../../domain/common'
import { assertValidBook } from '../../domain/book'
import { assertValidReadingCycle } from '../../domain/reading-cycle'
import { assertValidReadingRecord } from '../../domain/reading-record'
import { assertValidSourceReadingDay } from '../../domain/source-reading-day'
import { assertValidReadingContent } from '../../domain/reading-content'
import { assertValidDictionaryEntry } from '../../domain/dictionary'
import { assertValidBookCollection } from '../../domain/collection'
import { assertValidWork } from '../../domain/work'
import { assertValidActivityLog } from '../../domain/activity-log'
import { assertValidReadingGoal } from '../../domain/reading-goal'
import { assertValidReadingPreferences } from '../../domain/reading-preferences'
import { backupCollections, type BackupCollection, type DeviceBackup } from './backup-export'

export const backupLabels: Record<BackupCollection, string> = { books: '書籍', readingCycles: '閱讀輪次', readingRecords: '閱讀紀錄', sourceReadingDays: '來源每日統計', readingContents: '書摘與心得', dictionaries: '字典資料', collections: '系列與期刊', works: '作品', activityLogs: '活動紀錄', readingGoals: '閱讀目標', readingPreferences: '顯示設定' }
const maxJson = 40 * 1024 * 1024
const decoder = new TextDecoder('utf-8', { fatal: true })
function fail(message: string): never { throw new Error(message) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('資料格式不完整')
  return value as Record<string, unknown>
}
function dateTime(value: unknown) {
  if (typeof value !== 'string') fail('日期格式無效')
  assertIsoDateTime(value, '備份日期')
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z')) fail('日期無效')
}
export function validateBackup(value: unknown): DeviceBackup {
  const root = object(value)
  if (root.format !== 'readingcenter-device-backup' || root.version !== 1 || root.scope !== 'device-data') fail('請選擇閱讀中心下載的版本 1 備份檔')
  if (root.schemaVersion !== LOCAL_DATABASE_SCHEMA_VERSION) fail('備份資料版本與此程式不同，請保留原檔並更新程式後再檢查')
  dateTime(root.generatedAt)
  const data = object(root.data); const counts = object(root.counts)
  if (Object.keys(data).length !== backupCollections.length || Object.keys(counts).length !== backupCollections.length) fail('備份資料集合不完整')
  const validators = { books: assertValidBook, readingCycles: assertValidReadingCycle, readingRecords: assertValidReadingRecord, sourceReadingDays: assertValidSourceReadingDay, readingContents: assertValidReadingContent, dictionaries: assertValidDictionaryEntry, collections: assertValidBookCollection, works: assertValidWork, activityLogs: assertValidActivityLog, readingGoals: assertValidReadingGoal, readingPreferences: assertValidReadingPreferences }
  for (const key of backupCollections) {
    const rows = data[key]
    if (!Array.isArray(rows) || rows.length > 100000 || counts[key] !== rows.length) fail(`${backupLabels[key]}的筆數或格式不符`)
    const ids = new Set<string>()
    for (const raw of rows) {
      try {
        const row = object(raw)
        if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) fail('識別碼無效或重複')
        ids.add(row.id)
        if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 1 || row.schemaVersion !== 1) fail('資料版本無效')
        dateTime(row.createdAt); dateTime(row.updatedAt)
        const provenance = object(row.provenance)
        if (provenance.kind !== 'manual' && provenance.kind !== 'import') fail('來源格式無效')
        if (provenance.kind === 'import') {
          if (typeof provenance.sourceId !== 'string' || !provenance.sourceId.trim() || typeof provenance.externalId !== 'string' || !provenance.externalId.trim()) fail('匯入來源不完整')
          dateTime(provenance.importedAt)
        }
        // Domain validation also retains optional legacy fields without rewriting them.
        const validate = validators[key] as (row: never) => void
        validate(raw as never)
        assertPreviewFields(key, row)
        if (key === 'books' || key === 'works') {
          for (const field of [key === 'books' ? 'authorIds' : 'creatorIds', 'categoryIds', 'tagIds', 'sourceIds', 'titleAliases']) {
            if (!Array.isArray(row[field]) || (row[field] as unknown[]).some(id => typeof id !== 'string')) fail('書籍欄位不完整')
          }
          if (row.cover !== null) {
            const cover = object(row.cover)
            if (typeof cover.path !== 'string' || !cover.path.trim() || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(String(cover.mimeType))) fail('封面參照無效')
          }
        }
      } catch { fail(`${backupLabels[key]}有無效資料，請保留原始備份；未變更任何資料`) }
    }
  }
  return value as DeviceBackup
}

function assertPreviewFields(key: BackupCollection, row: Record<string, unknown>) {
  for (const field of ['startedAt', 'endedAt', 'finishedAt', 'recordedForAt']) if (field in row && row[field] !== null) dateTime(row[field])
  for (const field of ['progress', 'progressBefore', 'progressAfter']) {
    if (!(field in row) || row[field] === null) continue
    const progress = object(row[field])
    if (!['percent', 'page', 'chapter', 'position', ...(key === 'activityLogs' ? ['episode'] : [])].includes(String(progress.unit))) fail('進度單位無效')
  }
  const strings: Partial<Record<BackupCollection, string[]>> = { books: ['title', 'languageTag', 'bookNote', 'mediaTypeId'], works: ['title', 'languageTag', 'note', 'mediaType'], activityLogs: ['note'], readingContents: ['text'], dictionaries: ['name'], collections: ['name'] }
  for (const field of strings[key] ?? []) if (typeof row[field] !== 'string') fail('文字欄位無效')
  const nullableText: Partial<Record<BackupCollection, string[]>> = { books: ['preferredTitle', 'subtitle', 'originalTitle', 'isbn', 'publishedOn'], works: ['preferredTitle', 'subtitle', 'originalTitle'], dictionaries: ['color'], readingCycles: ['abandonedReason'] }
  for (const field of nullableText[key] ?? []) if (row[field] !== null && typeof row[field] !== 'string') fail('文字欄位不完整')
  if (key === 'dictionaries' && row.kind === 'author' && (!Array.isArray(row.aliases) || row.aliases.some(value => typeof value !== 'string'))) fail('作者別名無效')
  if (key === 'readingContents') {
    if (row.type === 'highlight') for (const field of ['note', 'locator']) if (row[field] !== null && typeof row[field] !== 'string') fail('書摘欄位無效')
    if (row.type === 'longReview' && row.title !== null && typeof row.title !== 'string') fail('心得標題無效')
  }
  if (key === 'books' || key === 'works') {
    if (!Array.isArray(row.externalReferences)) fail('來源對照無效')
    for (const raw of row.externalReferences) {
      const ref = object(raw)
      if (typeof ref.sourceTitle !== 'string') fail('來源書名無效')
      const names = ref[key === 'books' ? 'sourceAuthorNames' : 'sourceCreatorNames']
      if (!Array.isArray(names) || names.some(value => typeof value !== 'string')) fail('來源作者無效')
    }
  }
  if (key === 'books') {
    if (row.sequence !== null) {
      const sequence = object(row.sequence)
      if (!['volume', 'issue'].includes(String(sequence.kind)) || typeof sequence.label !== 'string') fail('冊期欄位無效')
    }
    if (row.serialization !== null) {
      const value = object(row.serialization)
      if (!['ongoing', 'completed', 'hiatus', 'unknown'].includes(String(value.status)) || (value.latestChapter !== null && typeof value.latestChapter !== 'string') || (value.updatedAt !== null && typeof value.updatedAt !== 'string')) fail('連載欄位無效')
    }
  }
  if (key === 'works') {
    const metadata = object(row.typeMetadata)
    if (!['publication', 'episodic', 'movie', 'other'].includes(String(metadata.kind))) fail('作品類型無效')
    if (metadata.kind === 'publication') for (const field of ['isbn', 'publishedOn', 'collectionId', 'publisherId']) if (metadata[field] !== null && typeof metadata[field] !== 'string') fail('作品出版欄位無效')
  }
  const nullableIds: Partial<Record<BackupCollection, string[]>> = { books: ['collectionId', 'publisherId'], readingRecords: ['cycleId', 'deviceId', 'sourceId'], readingContents: ['cycleId', 'readingRecordId'], activityLogs: ['cycleId', 'deviceId', 'sourceId'] }
  for (const field of nullableIds[key] ?? []) if (row[field] !== null && (typeof row[field] !== 'string' || !(row[field] as string).trim())) fail('資料關聯欄位無效')
  const enums: Partial<Record<BackupCollection, Record<string, string[]>>> = {
    books: { publicationKind: ['published', 'webSerial', 'webTranslation', 'other'] },
    readingCycles: { status: ['planned', 'reading', 'paused', 'completed', 'abandoned'] },
    dictionaries: { kind: ['author', 'publisher', 'category', 'tag', 'source', 'mediaType', 'device'] },
    collections: { kind: ['series', 'periodical'] },
    activityLogs: { activityType: ['read', 'watch'] }
  }
  for (const [field, allowed] of Object.entries(enums[key] ?? {})) if (!allowed.includes(String(row[field]))) fail('資料類型無效')
  if (key === 'books' && typeof row.bookNote !== 'string') fail('書籍備註無效')
  if (key === 'works' && typeof row.note !== 'string') fail('作品備註無效')
  if (key === 'readingContents' && row.recordedForAt !== null) dateTime(row.recordedForAt)
}

/** Reads only our version 1 STORE archives; checks both headers, bounds and CRC before JSON parsing. */
function readArchive(bytes: Uint8Array<ArrayBuffer>): Map<string, Uint8Array<ArrayBuffer>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const end = bytes.length - 22
  if (end < 0 || view.getUint32(end, true) !== 0x06054b50 || view.getUint16(end + 20, true) !== 0 || view.getUint16(end + 4, true) !== 0 || view.getUint16(end + 6, true) !== 0) fail('ZIP 格式不支援或檔案不完整')
  const count = view.getUint16(end + 10, true), start = view.getUint32(end + 16, true)
  if (count > 5002 || view.getUint16(end + 8, true) !== count || start + view.getUint32(end + 12, true) !== end) fail('ZIP 目錄無效')
  const entries = new Map<string, Uint8Array<ArrayBuffer>>()
  let position = start, localEnd = 0
  for (let index = 0; index < count; index++) {
    if (position + 46 > end || view.getUint32(position, true) !== 0x02014b50) fail('ZIP 目錄損壞')
    const flags = view.getUint16(position + 8, true), method = view.getUint16(position + 10, true), crc = view.getUint32(position + 16, true), size = view.getUint32(position + 24, true)
    const nameSize = view.getUint16(position + 28, true), local = view.getUint32(position + 42, true)
    const next = position + 46 + nameSize + view.getUint16(position + 30, true) + view.getUint16(position + 32, true)
    if (next > end || flags !== 0x800 || method !== 0 || view.getUint32(position + 20, true) !== size || local !== localEnd || local + 30 > start) fail('ZIP 壓縮方式不支援或資料不完整')
    const name = decoder.decode(bytes.subarray(position + 46, position + 46 + nameSize))
    if (!/^(readingcenter-data\.json|covers-manifest\.json|covers\/\d{5}-[0-9a-f]{64}\.(jpg|png|webp|avif))$/.test(name) || entries.has(name)) fail('ZIP 檔名無效或重複')
    if (view.getUint32(local, true) !== 0x04034b50 || view.getUint16(local + 6, true) !== flags || view.getUint16(local + 8, true) !== method || view.getUint32(local + 14, true) !== crc || view.getUint32(local + 18, true) !== size || view.getUint32(local + 22, true) !== size || view.getUint16(local + 26, true) !== nameSize) fail('ZIP 檔頭不一致')
    const begin = local + 30 + nameSize + view.getUint16(local + 28, true)
    if (begin + size > start || size > (name.startsWith('covers/') ? 10 * 1024 * 1024 : maxJson) || decoder.decode(bytes.subarray(local + 30, local + 30 + nameSize)) !== name) fail('ZIP 檔案大小或名稱不符')
    const content = bytes.subarray(begin, begin + size)
    let checksum = 0xffffffff
    for (const byte of content) { checksum ^= byte; for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0) }
    if (((checksum ^ 0xffffffff) >>> 0) !== crc) fail('ZIP 校驗失敗，檔案可能已損壞')
    entries.set(name, content); position = next; localEnd = begin + size
  }
  if (position !== end || localEnd !== start || !entries.has('readingcenter-data.json') || !entries.has('covers-manifest.json')) fail('ZIP 缺少必要檔案')
  return entries
}
export interface VerifiedBackup { backup: DeviceBackup; includedCovers: number; referenceCovers: number; warnings: string[]; coverFiles: Map<string, Uint8Array<ArrayBuffer>> }
export async function inspectBackup(file: Blob): Promise<VerifiedBackup> {
  if (!file.size || file.size > 128 * 1024 * 1024) fail('備份檔為空或超過 128 MB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const zipped = bytes[0] === 0x50 && bytes[1] === 0x4b
  if (!zipped && bytes.length > maxJson) fail('JSON 超過 40 MB')
  const entries = zipped ? readArchive(bytes) : null
  let backup: DeviceBackup
  try { backup = validateBackup(JSON.parse(decoder.decode(entries?.get('readingcenter-data.json') ?? bytes))) } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) fail('備份 JSON 無法讀取，請保留原始檔案')
    throw error
  }
  const paths = new Set([...backup.data.books, ...backup.data.works].flatMap(row => row.cover ? [row.cover.path] : []))
  let includedCovers = 0
  const coverFiles = new Map<string, Uint8Array<ArrayBuffer>>()
  if (entries) {
    const manifest = object(JSON.parse(decoder.decode(entries.get('covers-manifest.json')!)))
    if (manifest.version !== 1 || !Array.isArray(manifest.assets) || manifest.assets.length !== paths.size) fail('封面對照表不完整')
    const seen = new Set<string>(), used = new Set<string>()
    for (const value of manifest.assets) {
      const asset = object(value)
      if (typeof asset.sourcePath !== 'string' || !paths.has(asset.sourcePath) || seen.has(asset.sourcePath)) fail('封面來源對照不符')
      seen.add(asset.sourcePath)
      if (asset.status === 'reference-only') {
        if (asset.archivePath !== null || asset.sha256 !== null || asset.bytes !== null) fail('封面參照格式不符')
        continue
      }
      if (asset.status !== 'included' || typeof asset.archivePath !== 'string' || !asset.archivePath.startsWith('covers/') || used.has(asset.archivePath)) fail('封面圖片對照無效')
      const image = entries.get(asset.archivePath)
      if (!image?.length || image.length !== asset.bytes) fail('封面圖片缺少或大小不符')
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', image))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (hash !== asset.sha256 || !asset.archivePath.includes(`-${hash}.`) || !asset.sourcePath.includes(`/${hash}-`)) fail('封面圖片校驗失敗')
      used.add(asset.archivePath); includedCovers++; coverFiles.set(asset.sourcePath, image)
    }
    if (entries.size !== used.size + 2) fail('ZIP 含有未對照的檔案')
  }
  return { backup, includedCovers, referenceCovers: paths.size - includedCovers, warnings: relationWarnings(backup), coverFiles }
}
export function relationWarnings(backup: DeviceBackup): string[] {
  const data = backup.data, books = new Set(data.books.map(row => row.id)), works = new Set(data.works.map(row => row.id)), cycles = new Map(data.readingCycles.map(row => [row.id, row])), records = new Map(data.readingRecords.map(row => [row.id, row]))
  let missing = 0
  for (const row of [...data.readingCycles, ...data.readingRecords, ...data.readingContents, ...data.sourceReadingDays]) {
    if (row.bookId !== null && !books.has(row.bookId)) missing++
    if ('cycleId' in row && row.cycleId !== null && cycles.get(row.cycleId)?.bookId !== row.bookId) missing++
    if ('readingRecordId' in row && row.readingRecordId !== null && records.get(row.readingRecordId)?.bookId !== row.bookId) missing++
  }
  for (const row of data.activityLogs) if (!works.has(row.workId)) missing++
  return missing ? [`有 ${missing} 個書籍或紀錄關聯缺少或不一致，實際還原前需要核對。`] : []
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => JSON.stringify(key) + ':' + canonical(item)).join(',') + '}'
  return JSON.stringify(value)
}
export function compareBackups(incoming: DeviceBackup, current: DeviceBackup) {
  return backupCollections.map(key => {
    const existing = new Map<string, EntityMetadata>(current.data[key].map(row => [row.id, row]))
    const incomingIds = new Set(incoming.data[key].map(row => row.id))
    let added = 0, same = 0, changed = 0
    for (const row of incoming.data[key]) {
      const prior = existing.get(row.id)
      if (!prior) added++
      else if (canonical(prior) === canonical(row)) same++
      else changed++
    }
    return { key, added, same, changed, currentOnly: current.data[key].filter(row => !incomingIds.has(row.id)).length }
  })
}
