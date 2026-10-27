import { assertValidBook, createMetadata, getBookNotes, updateEntity, type AuthorEntry, type Book, type CreatorRole } from '../domain'
import type { StoredRemoteEntity } from '../server/entity-api'
import { CloudflareEntityClient, RemoteApiError } from '../sync/cloudflare/entity-client'
import { resolveNotionAuthorSource, resolveNotionAuthorUrl, type AuthorSourceContext } from './notion-author-url-evidence'

/** Only literal names. URLs, explicit roles and possible bilingual aliases need evidence. */
export function parseNotionAuthorNames(raw: string): string[] | null {
  if (!raw.trim() || /https?:\/\/|[：:]|\r|\n/.test(raw)) return null
  const names = [...new Set(raw.split(/[,|]/).map((name) => name.trim()).filter(Boolean))]
  if (!names.length || names.some((name) => name.length > 100)) return null
  if (names.length === 2 && names.some((name) => /^[A-Za-zÀ-ž .’'―-]+$/.test(name)) && names.some((name) => /[\u3400-\u9fff]/.test(name))) return null
  return names
}

export interface SourceCreatorCredit { name: string; role: CreatorRole }
/** Explicit source roles only: every name and role must be parsed, with no leftover text. */
export function parseNotionAuthorCredits(raw: string): SourceCreatorCredit[] | null {
  if (/https?:\/\/|[\r\n]/.test(raw)) return null
  const roleMap: Readonly<Record<string, CreatorRole>> = { 原作: 'original', 漫畫: 'manga', 畫: 'illustration', 繪圖: 'illustration', 監修: 'supervision', 口述: 'oral', 採訪撰文: 'interviewWriting' }
  const parts = raw.trim().split(/\s*\|\s*|\s{2,}/)
  const credits: SourceCreatorCredit[] = []
  for (const part of parts) {
    const match = part.match(/^(原作|漫畫|畫|繪圖|監修|口述|採訪撰文)[：:]\s*([^：:|,]+)$/)
    if (!match) return null
    const name = match[2].trim()
    if (!name || name.length > 100) return null
    const credit = { name, role: roleMap[match[1]] }
    if (!credits.some((item) => item.name === name && item.role === credit.role)) credits.push(credit)
  }
  return credits.length && credits.some((credit) => credit.role !== 'supervision') ? credits : null
}

// Same person verified by publisher: https://www.cite.com.tw/publisher/authors/26574
const VERIFIED_ALIAS_SOURCE = '艾芙琳．博洛克―達諾|Évelyne Bloch-Dano'
function parseSourceAuthors(text: string, context: AuthorSourceContext): { names: string[]; credits?: SourceCreatorCredit[]; aliases?: Record<string, string[]> } | null {
  if (text.trim() === VERIFIED_ALIAS_SOURCE) return { names: ['艾芙琳．博洛克―達諾'], aliases: { '艾芙琳．博洛克―達諾': ['Évelyne Bloch-Dano'] } }
  const source = resolveNotionAuthorSource(text, context)
  if (source) return source
  const credits = parseNotionAuthorCredits(text)
  if (credits) return { names: [...new Set(credits.map((credit) => credit.name))], credits }
  const verified = resolveNotionAuthorUrl(text)
  const names = verified ? [verified] : parseNotionAuthorNames(text)
  return names ? { names } : null
}

interface NotionAuthorSource { text: string; sourceUrls: string[] }
function getNotionAuthorSources(book: Book): NotionAuthorSource[] {
  if (book.provenance.kind !== 'import' || book.provenance.sourceId !== 'notion-csv-snapshot') return []
  const raw = getBookNotes(book).importSourceNotes
  if (!raw?.startsWith('Notion 歷史搬遷｜原始資料保留\n【來源第 ')) return []
  const blocks = raw.split(/【來源第 \d+ 列】\n/).slice(1)
  return blocks.map((block) => ({
    text: block.match(/(?:^|\n)作者：([\s\S]*?)\n來源：/)?.[1] ?? '',
    // Keep page evidence attached to the same source row as its author cell.
    sourceUrls: [...block.matchAll(/(?:^|\n)網址：([^\n]*)/g)].map((match) => match[1].trim()).filter(Boolean)
  }))
}
export function getNotionAuthorTexts(book: Book): string[] {
  return getNotionAuthorSources(book).map((source) => source.text)
}

export interface AuthorBackfillItem { book: Book; names: string[]; credits?: SourceCreatorCredit[]; aliases?: Record<string, string[]> }
export interface AuthorBackfillPlan { candidates: AuthorBackfillItem[]; preserved: number; unresolved: { bookId: string; title: string; reason: string }[] }

function readBook(item: StoredRemoteEntity): Book {
  if (item.kind !== 'book' || item.deletedAt || !item.payload || item.payload.id !== item.id) throw new Error('正式書籍資料不完整，未開始補作者')
  const book = item.payload as unknown as Book
  assertValidBook(book)
  if (!Array.isArray(book.authorIds)) throw new Error('作者欄位格式不符，未開始補作者')
  return { ...book, revision: item.revision }
}

export function prepareNotionAuthorBackfill(stored: StoredRemoteEntity[]): AuthorBackfillPlan {
  const result: AuthorBackfillPlan = { candidates: [], preserved: 0, unresolved: [] }
  for (const item of stored) {
    const book = readBook(item)
    if (book.provenance.kind !== 'import' || book.provenance.sourceId !== 'notion-csv-snapshot') continue
    if (book.authorIds.length || book.creatorCredits?.length || book.revision !== 1) { result.preserved++; continue }
    const sources = getNotionAuthorSources(book)
    const texts = sources.map((source) => source.text)
    const parsed = sources.map((source) => parseSourceAuthors(source.text, { title: book.title, sourceUrls: source.sourceUrls }))
    if (!texts.length || parsed.some((authors) => authors === null)) {
      result.unresolved.push({ bookId: book.id, title: book.title, reason: texts.some((text) => /https?:\/\//.test(text)) ? '作者網址需要來源查證' : texts.some((text) => text.trim()) ? '角色、別名或原文結構需要另行判斷' : '來源未提供可確認的作者姓名' })
      continue
    }
    const resolved = parsed.filter((authors) => authors !== null)
    // Mixed or differing role assignments across source rows require reconciliation.
    const assignments = resolved.map((authors) => JSON.stringify(authors.credits ?? null))
    if (new Set(assignments).size !== 1) {
      result.unresolved.push({ bookId: book.id, title: book.title, reason: '角色、別名或原文結構需要另行判斷' })
      continue
    }
    result.candidates.push({ book, names: [...new Set(resolved.flatMap((authors) => authors.names))], ...(resolved[0].credits ? { credits: resolved[0].credits } : {}), ...(resolved.some((authors) => authors.aliases) ? { aliases: Object.assign({}, ...resolved.map((authors) => authors.aliases ?? {})) } : {}) })
  }
  return result
}

export interface AuthorBackfillReport { total: number; added: number; skipped: number; stopped: boolean; issues: { bookId: string; title: string; reason: string }[] }
type Client = Pick<CloudflareEntityClient, 'list' | 'get' | 'apply'>

export async function runNotionAuthorBackfill(plan: AuthorBackfillPlan, client: Client, signal: AbortSignal, onProgress: (report: AuthorBackfillReport) => void): Promise<AuthorBackfillReport> {
  const report: AuthorBackfillReport = { total: plan.candidates.length, added: 0, skipped: 0, stopped: false, issues: [...plan.unresolved] }
  const dictionaries = await client.list('dictionary', true)
  const entries = new Map(dictionaries.map((item) => [item.id, item]))
  for (const candidate of plan.candidates) {
    if (signal.aborted) { report.stopped = true; break }
    try {
      const current = readBook(await client.get('book', candidate.book.id))
      if (JSON.stringify(current) !== JSON.stringify(candidate.book) || current.authorIds.length || current.creatorCredits?.length || current.revision !== 1) { report.skipped++; continue }
      const now = new Date().toISOString()
      const idsByName = new Map<string, string>()
      for (const name of candidate.names) {
        if (signal.aborted) throw new Error('已停止')
        // Same snapshot-scoped IDs as the original migration: no cross-source name merging.
        if (current.provenance.kind !== 'import') throw new Error('來源已變更')
        const snapshot = current.provenance.externalId.split(':')[0]
        if (!/^[0-9a-f]{64}$/.test(snapshot)) throw new Error('來源識別不完整')
        const id = `notion:dictionary:${snapshot}:author:${encodeURIComponent(name)}`
        const existing = entries.get(id)
        if (existing) {
          if (existing.deletedAt || existing.payload?.kind !== 'author' || existing.payload?.name !== name) throw new Error('作者字典已變更，保留原本資料')
          if (candidate.aliases?.[name]?.some((alias) => !Array.isArray(existing.payload?.aliases) || !existing.payload.aliases.includes(alias))) throw new Error('既有作者別名不同，保留原本字典')
        } else {
          const entity: AuthorEntry = { ...createMetadata({ id, now, provenance: { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: `${snapshot}:author:${name}`, importedAt: now } }), kind: 'author', name, color: null, aliases: candidate.aliases?.[name] ?? [] }
          entries.set(id, await client.apply({ operation: 'put', mutationId: crypto.randomUUID(), kind: 'dictionary', entityId: id, baseRevision: 0, entity, queuedAt: now, attemptCount: 0, lastAttemptAt: null, lastError: null }))
        }
        idsByName.set(name, id)
      }
      const creatorCredits = candidate.credits?.map((credit) => ({ creatorId: idsByName.get(credit.name)!, role: credit.role }))
      const authorIds = candidate.credits ? [...new Set(candidate.credits.filter((credit) => credit.role !== 'supervision').map((credit) => idsByName.get(credit.name)!))] : [...idsByName.values()]
      if (signal.aborted) throw new Error('已停止')
      await client.apply({ operation: 'put', mutationId: crypto.randomUUID(), kind: 'book', entityId: current.id, baseRevision: current.revision, entity: updateEntity(current, { authorIds, ...(creatorCredits ? { creatorCredits } : {}) }, now), queuedAt: now, attemptCount: 0, lastAttemptAt: null, lastError: null })
      report.added++
    } catch (error) {
      report.issues.push({ bookId: candidate.book.id, title: candidate.book.title, reason: error instanceof Error ? error.message : '補作者失敗' })
      if (signal.aborted || !(error instanceof RemoteApiError) || [401, 403, 429].includes(error.status) || error.status >= 500) { report.stopped = true; break }
    } finally { onProgress({ ...report, issues: [...report.issues] }) }
  }
  return report
}
