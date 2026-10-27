import { assertValidBook, createMetadata, getBookNotes, updateEntity, type Book, type NamedDictionaryEntry } from '../domain'
import type { StoredRemoteEntity } from '../server/entity-api'
import { CloudflareEntityClient, RemoteApiError } from '../sync/cloudflare/entity-client'

export const NOTION_MEDIA_LABELS = { book: '一般書籍', manga: '漫畫', webNovel: '網路小說', novel: '小說', magazine: '雜誌' } as const
export type NotionMediaType = keyof typeof NOTION_MEDIA_LABELS
export function classifyNotionMedia(categories: readonly string[]): NotionMediaType | null {
  const kinds = new Set<NotionMediaType>()
  for (const category of categories) {
    if (category === '漫畫') kinds.add('manga')
    if (category === '雜誌') kinds.add('magazine')
    if (category === '網路\\原創小說') kinds.add('webNovel')
    if (['小說', '輕小說', '奇幻\\科幻小說', '恐怖\\驚悚小說', '推理\\犯罪小說'].includes(category)) kinds.add('novel')
  }
  // A general book is the agreed fallback, not a claim about its narrower format.
  return kinds.size === 0 ? 'book' : kinds.size === 1 ? [...kinds][0] : null
}
interface Candidate { book: Book; mediaType: NotionMediaType }
export interface MediaBackfillPlan { candidates: Candidate[]; preserved: number; unresolved: { title: string; reason: string }[] }
export interface MediaBackfillReport { total: number; added: number; skipped: number; stopped: boolean; issues: { title: string; reason: string }[] }
type Client = Pick<CloudflareEntityClient, 'list' | 'get' | 'apply'>
function readBook(item: StoredRemoteEntity): Book {
  if (item.kind !== 'book' || item.deletedAt || !item.payload || item.payload.id !== item.id) throw new Error('書籍資料不完整')
  const book = item.payload as unknown as Book
  assertValidBook(book)
  return { ...book, revision: item.revision }
}
function sourceCategories(book: Book): string[] | null {
  if (book.provenance.kind !== 'import') return null
  const notes = getBookNotes(book).importSourceNotes
  if (!notes?.startsWith('Notion 歷史搬遷｜原始資料保留\n【來源第 ')) return null
  const blocks = notes.split(/【來源第 \d+ 列】\n/).slice(1)
  if (blocks.length !== 1 || notes.match(/【來源第 (\d+) 列】/)?.[1] !== book.provenance.externalId?.split(':')[1]) return null
  const raw = blocks[0].match(/(?:^|\n)主題：([^\n]*)/)
  return raw ? [...new Set(raw[1].split(',').map(part => part.trim()).filter(Boolean))] : null
}
function unchangedCategories(book: Book, snapshot: string, categories: string[], dictionaries: Map<string, StoredRemoteEntity>): boolean {
  const expected = categories.map(name => `notion:dictionary:${snapshot}:category:${encodeURIComponent(name)}`)
  return expected.length === book.categoryIds.length && expected.every((id, index) => book.categoryIds[index] === id && !dictionaries.get(id)?.deletedAt && dictionaries.get(id)?.payload?.kind === 'category' && dictionaries.get(id)?.payload?.name === categories[index])
}
export function prepareNotionMediaBackfill(books: StoredRemoteEntity[], dictionaries: StoredRemoteEntity[]): MediaBackfillPlan {
  const plan: MediaBackfillPlan = { candidates: [], preserved: 0, unresolved: [] }
  const entries = new Map(dictionaries.map(item => [item.id, item]))
  for (const stored of books) {
    const book = readBook(stored)
    if (book.provenance.kind !== 'import' || book.provenance.sourceId !== 'notion-csv-snapshot' || !/^[0-9a-f]{64}:\d+$/.test(book.provenance.externalId)) continue
    const snapshot = book.provenance.externalId.split(':')[0]
    if (book.mediaTypeId !== `notion:dictionary:${snapshot}:mediaType:unmapped`) { plan.preserved++; continue }
    const categories = sourceCategories(book)
    if (!categories || !unchangedCategories(book, snapshot, categories, entries)) { plan.preserved++; continue }
    const mediaType = classifyNotionMedia(categories)
    if (mediaType) plan.candidates.push({ book, mediaType })
    else plan.unresolved.push({ title: book.title, reason: '原始分類不足或類型衝突，保留未分類' })
  }
  return plan
}
export async function runNotionMediaBackfill(plan: MediaBackfillPlan, client: Client, signal: AbortSignal, onProgress: (report: MediaBackfillReport) => void): Promise<MediaBackfillReport> {
  const report: MediaBackfillReport = { total: plan.candidates.length, added: 0, skipped: 0, stopped: false, issues: [...plan.unresolved] }
  for (const candidate of plan.candidates) {
    if (signal.aborted) { report.stopped = true; break }
    try {
      const stored = await client.get('book', candidate.book.id)
      const current = readBook(stored)
      if (JSON.stringify(current) !== JSON.stringify(candidate.book)) { report.skipped++; continue }
      const dictionaries = await client.list('dictionary', true)
      if (!prepareNotionMediaBackfill([stored], dictionaries).candidates.some(item => item.mediaType === candidate.mediaType)) { report.skipped++; continue }
      if (current.provenance.kind !== 'import') throw new Error('匯入來源已變更')
      const existing = dictionaries.find(item => item.id === candidate.mediaType)
      const now = new Date().toISOString()
      if (existing) {
        if (existing.deletedAt || existing.payload?.kind !== 'mediaType' || existing.payload?.name !== NOTION_MEDIA_LABELS[candidate.mediaType]) throw new Error('既有媒體類型字典不同，保留書籍資料')
      } else {
        const entry: NamedDictionaryEntry = { ...createMetadata({ id: candidate.mediaType, now, provenance: { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: `${current.provenance.externalId}:mediaType:${candidate.mediaType}`, importedAt: now } }), kind: 'mediaType', name: NOTION_MEDIA_LABELS[candidate.mediaType], color: null }
        if (signal.aborted) { report.stopped = true; break }
        await client.apply({ operation: 'put', mutationId: crypto.randomUUID(), kind: 'dictionary', entityId: entry.id, baseRevision: 0, entity: entry, queuedAt: now, attemptCount: 0, lastAttemptAt: null, lastError: null })
      }
      if (signal.aborted) { report.stopped = true; break }
      await client.apply({ operation: 'put', mutationId: crypto.randomUUID(), kind: 'book', entityId: current.id, baseRevision: current.revision, entity: updateEntity(current, { mediaTypeId: candidate.mediaType }, now), queuedAt: now, attemptCount: 0, lastAttemptAt: null, lastError: null })
      report.added++
    } catch (error) {
      report.issues.push({ title: candidate.book.title, reason: error instanceof Error ? error.message : '補媒體類型失敗' })
      if (signal.aborted || !(error instanceof RemoteApiError) || [401, 403, 429].includes(error.status) || error.status >= 500) { report.stopped = true; break }
    } finally { onProgress({ ...report, issues: [...report.issues] }) }
  }
  return report
}
