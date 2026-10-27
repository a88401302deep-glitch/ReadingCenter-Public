import type { Book } from '../domain'
import { parseNotionCsv } from './notion-csv'
import type { buildNotionImportPlan } from './notion-import-plan'
import { checkNotionReimport } from './notion-reimport-check'
import type { openNotionZip } from './notion-zip-reader'

type Plan = ReturnType<typeof buildNotionImportPlan>
type Zip = Awaited<ReturnType<typeof openNotionZip>>
export interface CoverBackfillItem { bookId: string; rowNumber: number; filename: string; title: string; baseRevision: number }
export interface CoverBackfillPlan {
  csvSha256: string
  candidates: CoverBackfillItem[]
  preserved: number
  noReference: number
  issues: { rowNumber: number; message: string }[]
}

/** Only cover references may differ. Keep original snapshot identities and verify every other cell. */
export function matchCoverExport(plan: Plan, csv: string) {
  const document = parseNotionCsv(csv)
  if (document.diagnostics.some((item) => item.severity === 'error') || document.rows.length !== plan.items.length || !document.headers.includes('封面')) throw new Error('ZIP CSV 結構與原始資料不符')
  for (let index = 0; index < plan.items.length; index++) {
    const original = plan.items[index]
    const exported = document.rows[index]
    if (original.rowNumber !== exported.rowNumber || Object.keys(original.source).length !== document.headers.length ||
      Object.entries(original.source).some(([key, value]) => !(key in exported.raw) || (key !== '封面' && exported.raw[key] !== value))) {
      throw new Error('ZIP CSV 與原始資料內容或列順序不符；未開始補封面')
    }
  }
  return document.rows
}

export async function prepareNotionCoverBackfill(plan: Plan, zip: Zip, books: Book[]): Promise<CoverBackfillPlan> {
  const matches = []
  for (const filename of zip.filenames.filter((name) => /\.csv$/i.test(name))) {
    try { matches.push(matchCoverExport(plan, await zip.readCsv(filename))) } catch { /* Other CSVs in an export need not describe this book collection. */ }
  }
  if (matches.length !== 1) throw new Error('ZIP 中找不到唯一符合原始資料的完整書籍 CSV；未開始補封面')
  const links = checkNotionReimport(plan, books)
  const bookById = new Map(books.map((book) => [book.id, book]))
  const report: CoverBackfillPlan = { csvSha256: plan.csvSha256, candidates: [], preserved: 0, noReference: 0, issues: [] }
  const seen = new Set<string>()
  for (const row of matches[0]) {
    const reference = row.raw['封面'].trim()
    if (!reference) { report.noReference++; continue }
    const link = links.entries.find((entry) => entry.rowNumber === row.rowNumber)!
    if (link.bookIds.length !== 1) { report.issues.push({ rowNumber: row.rowNumber, message: '來源未唯一連到已匯入書籍' }); continue }
    const book = bookById.get(link.bookIds[0])!
    if (book.cover) { report.preserved++; continue }
    if (seen.has(book.id)) { report.issues.push({ rowNumber: row.rowNumber, message: '多個來源列對應同書，封面需另行確認' }); continue }
    let filename: string
    try { filename = zip.filenames.includes(reference) ? reference : decodeURIComponent(reference) } catch { filename = '' }
    if (!zip.filenames.includes(filename) || !/\.(jpe?g|png|webp|avif)$/i.test(filename)) {
      report.issues.push({ rowNumber: row.rowNumber, message: /^https?:\/\//i.test(reference) ? '外部封面網址，未搬入' : '多張候選圖片或 ZIP 缺少封面，未自動選圖' }); continue
    }
    seen.add(book.id)
    report.candidates.push({ bookId: book.id, rowNumber: row.rowNumber, filename, title: book.title, baseRevision: book.revision })
  }
  // A merged book with differing source covers must not receive an arbitrary first image.
  const duplicateIds = new Set(report.issues.filter((item) => item.message.startsWith('多個來源列')).flatMap((item) => links.entries.find((entry) => entry.rowNumber === item.rowNumber)?.bookIds ?? []))
  report.candidates = report.candidates.filter((item) => {
    if (!duplicateIds.has(item.bookId)) return true
    report.issues.push({ rowNumber: item.rowNumber, message: '多個來源列對應同書，封面需另行確認' })
    return false
  })
  return report
}

export interface CoverBackfillReport { total: number; added: number; preserved: number; issues: { rowNumber: number; message: string }[]; stopped: boolean }
export async function runNotionCoverBackfill(plan: CoverBackfillPlan, zip: Zip, options: { signal: AbortSignal; fetch?: typeof fetch; onProgress: (report: CoverBackfillReport) => void }): Promise<CoverBackfillReport> {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis)
  const report: CoverBackfillReport = { total: plan.candidates.length, added: 0, preserved: plan.preserved, issues: [...plan.issues], stopped: false }
  for (const item of plan.candidates) {
    if (options.signal.aborted) { report.stopped = true; break }
    try {
      const bytes = await zip.readImage(item.filename)
      const mimeType = /\.png$/i.test(item.filename) ? 'image/png' : /\.webp$/i.test(item.filename) ? 'image/webp' : /\.avif$/i.test(item.filename) ? 'image/avif' : 'image/jpeg'
      const upload = await request('/api/v1/covers/notion', { method: 'POST', credentials: 'include', signal: options.signal, headers: { 'Content-Type': mimeType, 'X-Book-Id': item.bookId, 'X-Book-Title': encodeURIComponent(item.title) }, body: new Blob([Uint8Array.from(bytes)], { type: mimeType }) })
      const uploaded = await readResponse(upload)
      if (!uploaded?.cover || typeof uploaded.cover.path !== 'string' || uploaded.cover.mimeType !== mimeType) throw new Error('封面上傳回應無法確認，已停止')
      const response = await request('/api/v1/import/notion/cover', { method: 'POST', credentials: 'include', signal: options.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: item.bookId, csvSha256: plan.csvSha256, rowNumber: item.rowNumber, baseRevision: item.baseRevision, cover: uploaded.cover, mutationId: crypto.randomUUID() }) })
      const result = await readResponse(response)
      if (result?.status === 'added') report.added++
      else if (result?.status === 'already-covered') report.preserved++
      else throw new Error('補封面回應無法確認，已停止')
    } catch (error) {
      if (!options.signal.aborted) report.issues.push({ rowNumber: item.rowNumber, message: error instanceof Error ? error.message : '補封面失敗' })
      if (options.signal.aborted || !(error instanceof CoverHttpError) || [401, 403, 429].includes(error.status) || error.status >= 500) { report.stopped = true; break }
    } finally { options.onProgress({ ...report, issues: [...report.issues] }) }
  }
  return report
}
class CoverHttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
async function readResponse(response: Response) {
  const value = await response.json()
  if (!response.ok) throw new CoverHttpError(response.status, value?.error?.message || `補封面失敗（${response.status}）`)
  return value?.data
}
