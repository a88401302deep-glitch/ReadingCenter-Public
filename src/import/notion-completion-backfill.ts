import { assertValidBook, assertValidReadingCycle, createMetadata, getBookNotes, type Book, type ReadingCycle } from '../domain'
import type { StoredRemoteEntity } from '../server/entity-api'
import { CloudflareEntityClient, RemoteApiError } from '../sync/cloudflare/entity-client'

interface Candidate { book: Book; externalId: string; days: number | null }
export interface CompletionBackfillPlan { candidates: Candidate[]; preserved: number }
export interface CompletionBackfillReport { total: number; added: number; skipped: number; stopped: boolean; issues: { title: string; reason: string }[] }
type Client = Pick<CloudflareEntityClient, 'list' | 'get' | 'apply'>
function readBook(item: StoredRemoteEntity): Book {
  if (item.kind !== 'book' || item.deletedAt || !item.payload || item.payload.id !== item.id) throw new Error('書籍資料不完整')
  const book = item.payload as unknown as Book
  assertValidBook(book)
  return { ...book, revision: item.revision }
}
function candidateFor(book: Book): Candidate | null {
  if (book.provenance.kind !== 'import' || book.provenance.sourceId !== 'notion-csv-snapshot' || !/^[0-9a-f]{64}:\d+$/.test(book.provenance.externalId)) return null
  const notes = getBookNotes(book).importSourceNotes
  if (!notes?.startsWith('Notion 歷史搬遷｜原始資料保留\n【來源第 ')) return null
  const blocks = notes.split(/【來源第 \d+ 列】\n/).slice(1)
  // Only the missing-evidence case audited in the historical migration.
  if (blocks.length !== 1) return null
  const block = blocks[0]
  const field = (name: string) => block.match(new RegExp(`(?:^|\\n)${name}：([^\\n]*)`))?.[1].trim()
  const row = notes.match(/【來源第 (\d+) 列】/)?.[1]
  if (row !== book.provenance.externalId.split(':')[1] || field('閱讀') !== '已讀完' || field('時間') !== '' || field('關聯生活點滴') !== '') return null
  const match = /^總共閱讀(\d+)天$/.exec(field('閱讀時間') ?? '')
  if (!match || !Number.isSafeInteger(Number(match[1]))) return null
  return { book, externalId: book.provenance.externalId, days: Number(match[1]) || null }
}
function hasCycle(cycles: StoredRemoteEntity[], candidate: Candidate): boolean {
  return cycles.some((item) => item.id === `notion:cycle:${candidate.externalId}` || item.payload?.bookId === candidate.book.id)
}
export function prepareNotionCompletionBackfill(books: StoredRemoteEntity[], cycles: StoredRemoteEntity[]): CompletionBackfillPlan {
  const plan: CompletionBackfillPlan = { candidates: [], preserved: 0 }
  for (const stored of books) {
    const candidate = candidateFor(readBook(stored))
    if (!candidate) continue
    if (hasCycle(cycles, candidate)) plan.preserved++
    else plan.candidates.push(candidate)
  }
  return plan
}
export async function runNotionCompletionBackfill(plan: CompletionBackfillPlan, client: Client, signal: AbortSignal, onProgress: (report: CompletionBackfillReport) => void): Promise<CompletionBackfillReport> {
  const report: CompletionBackfillReport = { total: plan.candidates.length, added: 0, skipped: 0, stopped: false, issues: [] }
  for (const candidate of plan.candidates) {
    if (signal.aborted) { report.stopped = true; break }
    try {
      const current = readBook(await client.get('book', candidate.book.id))
      if (JSON.stringify(current) !== JSON.stringify(candidate.book) || !candidateFor(current) || hasCycle(await client.list('readingCycle', true), candidate)) { report.skipped++; continue }
      if (signal.aborted) { report.stopped = true; break }
      const now = new Date().toISOString()
      const cycle: ReadingCycle = {
        ...createMetadata({ id: `notion:cycle:${candidate.externalId}`, now, provenance: { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: candidate.externalId, importedAt: now } }),
        bookId: current.id, sequence: 1, status: 'completed', startedAt: null, finishedAt: null, completionDate: null, reportedReadingDays: candidate.days, abandonedReason: null
      }
      assertValidReadingCycle(cycle)
      await client.apply({ operation: 'put', mutationId: crypto.randomUUID(), kind: 'readingCycle', entityId: cycle.id, baseRevision: 0, entity: cycle, queuedAt: now, attemptCount: 0, lastAttemptAt: null, lastError: null })
      report.added++
    } catch (error) {
      report.issues.push({ title: candidate.book.title, reason: error instanceof Error ? error.message : '補正失敗' })
      if (signal.aborted || !(error instanceof RemoteApiError) || [401, 403, 429].includes(error.status) || error.status >= 500) { report.stopped = true; break }
    } finally { onProgress({ ...report, issues: [...report.issues] }) }
  }
  return report
}
