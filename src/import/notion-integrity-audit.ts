import { parseNotionCsv } from './notion-csv'
import { assertValidBook, getBookNotes, type Book } from '../domain'
import type { StoredRemoteEntity } from '../server/entity-api'
import { createReadingCenterNotionPreview } from './reading-center-notion'
import { normalizeReadingCenterNotionPreview } from './reading-center-notion-normalization'
import { getNotionPublisherDisplayProposal } from './notion-publisher-normalization'

export const AUDIT_FIELDS = ['評分', '出版社', '來源', '分類', '標籤', '短評', '完讀日期', '閱讀天數', '閱讀狀態'] as const
export type AuditField = typeof AUDIT_FIELDS[number]
export type AuditResult = '相符' | '正式欄位缺少' | '內容不同' | '原始空白' | '需另判定' | '已刪除'
export const AUDIT_RESULTS: AuditResult[] = ['相符', '正式欄位缺少', '內容不同', '原始空白', '需另判定', '已刪除']
interface AuditDetail { title: string; field: string; result: AuditResult; reason: string }
export interface NotionIntegrityAudit {
  books: number; checked: number; uncheckable: number; deletedBooks: number
  longReviewFlags: number; relatedNoteLinks: number
  coverage?: { total: number; present: number; deleted: number; missing: number }
  fields: Record<AuditField, Record<AuditResult, number>>; details: AuditDetail[]
}
export interface NotionAuditSnapshot { csvSha256: string; rows: ReadonlyMap<string, Record<string, string>> }
export async function createNotionAuditSnapshot(csv: string): Promise<NotionAuditSnapshot> {
  const text = csv.replace(/^\uFEFF/, '')
  const document = parseNotionCsv(text)
  if (!document.rows.length || document.diagnostics.length || SOURCE_FIELDS.some(field => !document.headers.includes(field))) throw new Error('CSV 欄位或列格式不完整，未進行核對。')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  const csvSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  return { csvSha256, rows: new Map(document.rows.map(row => [`${csvSha256}:${row.rowNumber}`, Object.fromEntries(Object.entries(row.raw).map(([key, value]) => [key, value.trim()]))])) }
}
// The source field order is fixed by the preserved historical CSV export.
const SOURCE_FIELDS = ['書名', 'Created time', 'Rollup', 'TD', '一行心得', '主題', '作者', '來源', '出版社', '喜好', '完', '封面', '年度', '心得', '時間', '標籤', '紀錄表', '綜合筆記倉庫', '網址', '評分', '讀完', '閱聽統計表', '閱讀', '閱讀時間', '關聯生活點滴']
function sourceFor(book: Book): Record<string, string> | null {
  const notes = getBookNotes(book).importSourceNotes
  if (!notes?.startsWith('Notion 歷史搬遷｜原始資料保留\n')) return null
  const blocks = [...notes.matchAll(/【來源第 (\d+) 列】\n/g)]
  if (blocks.length !== 1 || book.provenance.kind !== 'import' || blocks[0][1] !== book.provenance.externalId.split(':')[1]) return null
  const block = notes.slice(blocks[0].index! + blocks[0][0].length)
  const matches = [...block.matchAll(/^([^\n：]+)：/gm)].filter(m => SOURCE_FIELDS.includes(m[1]))
  if (matches.length !== SOURCE_FIELDS.length || matches.some((m, i) => m[1] !== SOURCE_FIELDS[i])) return null
  return Object.fromEntries(matches.map((m, i) => {
    const start = m.index! + m[0].length
    const newline = block.indexOf('\n', start)
    const end = matches[i + 1]?.index ?? (newline < 0 ? block.length : newline)
    return [m[1], block.slice(start, end).trim()]
  }))
}
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const split = (value: string) => [...new Set(value.split(',').map(x => x.trim()).filter(Boolean))].sort()
export function auditNotionIntegrity(books: StoredRemoteEntity[], dictionaries: StoredRemoteEntity[], contents: StoredRemoteEntity[], cycles: StoredRemoteEntity[], snapshot?: NotionAuditSnapshot): NotionIntegrityAudit {
  const report: NotionIntegrityAudit = { books: 0, checked: 0, uncheckable: 0, deletedBooks: books.filter(x => x.deletedAt && x.id.startsWith('notion:book:')).length, longReviewFlags: 0, relatedNoteLinks: 0, fields: Object.fromEntries(AUDIT_FIELDS.map(field => [field, Object.fromEntries(AUDIT_RESULTS.map(result => [result, 0]))])) as NotionIntegrityAudit['fields'], details: [] }
  if (snapshot) {
    const live = new Set<string>(), deleted = new Set<string>()
    for (const stored of books) {
      if (stored.kind === 'book' && stored.deletedAt && stored.id.startsWith('notion:book:') && snapshot.rows.has(stored.id.slice('notion:book:'.length))) deleted.add(stored.id.slice('notion:book:'.length))
      const book = stored.payload as unknown as Book | null
      if (!book || book.provenance?.kind !== 'import' || book.provenance.sourceId !== 'notion-csv-snapshot') continue
      const ids = [book.provenance.externalId, ...(book.externalReferences ?? []).filter(ref => ref.sourceId === 'notion-csv-snapshot').map(ref => ref.externalId)]
      for (const id of ids) if (snapshot.rows.has(id)) (stored.deletedAt ? deleted : live).add(id)
    }
    if (!live.size && !deleted.size) throw new Error('CSV 與正式書庫的搬遷來源不相符，請選擇原本匯入的 CSV。')
    report.coverage = { total: snapshot.rows.size, present: live.size, deleted: 0, missing: 0 }
    for (const [id, raw] of snapshot.rows) if (!live.has(id)) {
      const wasDeleted = deleted.has(id)
      if (wasDeleted) report.coverage.deleted++; else report.coverage.missing++
      report.details.push({ title: raw['書名'] || `未命名（Notion 來源第 ${id.split(':')[1]} 列）`, field: '原始列對應', result: wasDeleted ? '已刪除' : '正式欄位缺少', reason: wasDeleted ? '僅找到已刪除書籍的來源參照；不自動恢復' : '未找到正式書籍的相同來源識別；不依書名猜測配對' })
    }
  }
  const entries = new Map(dictionaries.map(x => [x.id, x]))
  const add = (book: Book, field: AuditField, result: AuditResult, reason = '') => {
    report.fields[field][result]++
    if (!['相符', '原始空白'].includes(result)) report.details.push({ title: book.title, field, result, reason })
  }
  const dictionary = (book: Book, field: AuditField, raw: string, ids: string[], kind: string, names = split(raw)) => {
    if (!raw) { add(book, field, '原始空白'); return }
    if (!ids.length) { add(book, field, '正式欄位缺少'); return }
    const found = ids.map(id => entries.get(id))
    if (found.some(x => x?.deletedAt)) { add(book, field, '已刪除', '參照的字典已刪除'); return }
    if (found.some(x => !x?.payload || x.payload.kind !== kind)) { add(book, field, '正式欄位缺少', '字典參照缺少或類型不同'); return }
    const actual = [...new Set(found.map(x => String(x!.payload!.name)))].sort()
    add(book, field, equal(actual, names.sort()) ? '相符' : '內容不同', '以字典顯示名稱與保留的來源比較；不自動覆蓋')
  }
  for (const stored of books) {
    if (stored.deletedAt || stored.payload?.provenance == null) continue
    const book = stored.payload as unknown as Book
    if (book.provenance.kind !== 'import' || book.provenance.sourceId !== 'notion-csv-snapshot') continue
    if (stored.kind !== 'book' || book.id !== stored.id) throw new Error('正式書籍資料不完整')
    assertValidBook(book); report.books++
    const raw = snapshot?.rows.get(book.provenance.externalId) ?? sourceFor(book)
    if (!raw) { report.uncheckable++; report.details.push({ title: book.title, field: '來源資料', result: '需另判定', reason: getBookNotes(book).importSourceNotes?.trim() ? '保留的來源原文格式不完整或含多列，需與原始 CSV 比對；未列入欄位相符統計' : '未保留可核對的來源原文；需與原始 CSV 比對，不能據此判定正式資料遺失' }); continue }
    report.checked++
    const quote = (value: string) => `"${value.replaceAll('"', '""')}"`
    const csv = Object.keys(raw).map(quote).join(',') + '\n' + Object.values(raw).map(quote).join(',')
    const normalized = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))[0]
    if (normalized.reviewCodes.some(x => x === 'invalid_rating' || x === 'zero_rating_conflict')) add(book, '評分', '需另判定', '原始評分格式或星等衝突')
    else if (normalized.proposed.rating === null) add(book, '評分', '原始空白')
    else add(book, '評分', book.rating == null ? '正式欄位缺少' : equal(book.rating, { value: normalized.proposed.rating, scale: 5 }) ? '相符' : '內容不同')
    dictionary(book, '出版社', raw['出版社'], book.publisherId ? [book.publisherId] : [], 'publisher', [getNotionPublisherDisplayProposal(raw['出版社'])?.displayName ?? raw['出版社']])
    dictionary(book, '來源', raw['來源'], book.sourceIds, 'source', [raw['來源']])
    dictionary(book, '分類', raw['主題'], book.categoryIds, 'category')
    dictionary(book, '標籤', raw['標籤'], book.tagIds, 'tag')
    const sourceId = book.provenance.externalId
    const review = contents.find(x => x.id === `notion:short-review:${sourceId}`)
    if (!raw['一行心得']) add(book, '短評', '原始空白')
    else if (review?.deletedAt) add(book, '短評', '已刪除')
    else if (!review?.payload) add(book, '短評', '正式欄位缺少')
    else add(book, '短評', review.payload.bookId === book.id && review.payload.type === 'shortReview' && review.payload.text === raw['一行心得'] ? '相符' : '內容不同')
    const cycle = cycles.find(x => x.id === `notion:cycle:${sourceId}`)
    const statuses: Record<string, string> = { 已讀完: 'completed', 閱讀中: 'reading', 暫停: 'paused', 棄坑: 'abandoned', 尚未開始: 'planned', '閱讀(連載)': 'reading' }
    const sourceStatus = statuses[raw['閱讀']]
    const hasEvidence = Boolean(raw['時間'] || raw['關聯生活點滴'])
    const statusNeedsCycle = sourceStatus && (sourceStatus !== 'planned' || hasEvidence)
    const cycleResult: AuditResult = cycle?.deletedAt ? '已刪除' : !cycle?.payload ? '正式欄位缺少' : cycle.payload.bookId !== book.id ? '內容不同' : '相符'
    if (!raw['書名'] && !hasEvidence && raw['閱讀時間'] === '總共閱讀0天' && sourceStatus !== 'completed') add(book, '閱讀狀態', '需另判定', '原始書名空白，且沒有日期、日誌關聯或正數閱讀天數；搬遷保留來源列，未補造閱讀週期')
    else if (!sourceStatus || sourceStatus === 'abandoned' || (sourceStatus === 'planned' && hasEvidence)) add(book, '閱讀狀態', '需另判定', '原始狀態不明、棄讀原因缺少或未開始與閱讀證據衝突')
    else if (!statusNeedsCycle) add(book, '閱讀狀態', '原始空白', '明確尚未開始，無須補造閱讀週期')
    else add(book, '閱讀狀態', cycleResult !== '相符' ? cycleResult : cycle!.payload!.status === sourceStatus ? '相符' : '內容不同')
    if (!raw['時間']) add(book, '完讀日期', '原始空白')
    else if (sourceStatus !== 'completed' || !normalized.proposed.completionDate) add(book, '完讀日期', '需另判定', '原始日期與狀態衝突或日期格式未確認')
    else add(book, '完讀日期', cycleResult !== '相符' ? cycleResult : equal(cycle!.payload!.completionDate, normalized.proposed.completionDate) ? '相符' : cycle!.payload!.completionDate == null ? '正式欄位缺少' : '內容不同')
    const days = /^總共閱讀(\d+)天$/.exec(raw['閱讀時間'])
    if (!days || !Number.isSafeInteger(Number(days[1]))) add(book, '閱讀天數', '需另判定')
    else if (Number(days[1]) === 0 || !statusNeedsCycle) add(book, '閱讀天數', '原始空白', '來源零天或無閱讀週期需求')
    else if (sourceStatus === 'abandoned' || sourceStatus === 'planned') add(book, '閱讀天數', '需另判定', '原始閱讀狀態尚未對應正式週期')
    else add(book, '閱讀天數', cycleResult !== '相符' ? cycleResult : cycle!.payload!.reportedReadingDays === Number(days[1]) ? '相符' : cycle!.payload!.reportedReadingDays == null ? '正式欄位缺少' : '內容不同')
    if (raw['心得'] === 'Yes') report.longReviewFlags++
    if (raw['綜合筆記倉庫']) report.relatedNoteLinks++
  }
  return report
}
