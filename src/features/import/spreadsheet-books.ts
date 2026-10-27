import { createInMemoryRepositories, type ReadingCenterRepositories } from '../../data'
import { createMetadata, updateEntity, getBookDisplayTitle, type ReadingCycleStatus } from '../../domain'
import { parseNotionCsv } from '../../import/notion-csv'
import { openBinaryZip } from '../../import/notion-zip-reader'
import { BookService, type BookDraft } from '../books/book-service'
import { ReadingCycleService } from '../reading-cycles/reading-cycle-service'
import { ReadingContentService } from '../reading-contents/reading-content-service'
export interface SheetBook { row: number; draft: BookDraft; status: ReadingCycleStatus | null; completedOn: string | null; review: string; categories: string[]; tags: string[]; sources: string[] }
export interface SheetPreview { rows: SheetBook[]; extraColumns: string[] }
const normalized = (text: string) => text.normalize('NFKC').trim().toLocaleLowerCase()
const fields: Record<string, string[]> = {
 title: ['書名', '出版書名', '名稱', 'title'], author: ['作者', 'author'], publisher: ['出版社', 'publisher'], isbn: ['ISBN', 'isbn'], type: ['類型', 'type'], status: ['閱讀狀態', '狀態', 'status'], date: ['完讀日期', '完成日期', 'completedOn'], review: ['心得', '短評', 'review'], note: ['備註', 'note'], cover: ['封面', '封面網址', 'cover'], categories: ['分類', 'category'], tags: ['標籤', 'tags'], sources: ['來源', 'source']
}
function xml(text: string) { if (/<!DOCTYPE/i.test(text)) throw new Error('Excel XML 內容不支援'); const doc = new DOMParser().parseFromString(text, 'application/xml'); if (doc.querySelector('parsererror')) throw new Error('Excel 工作表損壞'); return doc }
export async function readSpreadsheet(file: File): Promise<SheetPreview> {
 if (file.size > 20 * 1024 * 1024) throw new Error('表格請小於 20 MB')
 const xlsx = /\.xlsx$/i.test(file.name)
 let table: string[][]
 if (/\.csv$/i.test(file.name)) {
  const parsed = parseNotionCsv(await file.text())
  if (parsed.diagnostics.some(item => item.code === 'duplicate_header' || item.code === 'column_count_mismatch')) throw new Error('CSV 欄位數不一致或有重複欄名，請先修正')
  table = [parsed.headers, ...parsed.rows.map(row => row.cells)]
 } else if (xlsx) {
  const zip = await openBinaryZip(file)
  const read = async (path: string) => xml(new TextDecoder('utf-8', { fatal: true }).decode(await zip.readBinary(path, 8 * 1024 * 1024)))
  const workbook = await read('xl/workbook.xml'), relations = await read('xl/_rels/workbook.xml.rels')
  const id = workbook.getElementsByTagName('sheet')[0]?.getAttribute('r:id')
  const target = [...relations.getElementsByTagName('Relationship')].find(item => item.getAttribute('Id') === id)?.getAttribute('Target')
  if (!target || /\.\.|:|\\/.test(target)) throw new Error('找不到可匯入的 Excel 工作表')
  const path = target.startsWith('/xl/') ? target.slice(1) : `xl/${target}`
  const shared = zip.filenames.includes('xl/sharedStrings.xml') ? [...(await read('xl/sharedStrings.xml')).getElementsByTagName('si')].map(n => n.textContent ?? '') : []
  const sheet = await read(path)
  table = [...sheet.getElementsByTagName('row')].map(row => {
   const cells: string[] = []
   for (const cell of row.getElementsByTagName('c')) {
    if (cell.getElementsByTagName('f').length) throw new Error('請將 Excel 公式貼成純數值或文字後匯入')
    const col = cell.getAttribute('r')?.match(/^[A-Z]+/)?.[0]
    if (!col) throw new Error('Excel 欄位位置無效')
    const index = [...col].reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1
    if (index > 100) throw new Error('Excel 欄位過多')
    const value = cell.getElementsByTagName('v')[0]?.textContent ?? ''
    cells[index] = cell.getAttribute('t') === 's' ? shared[Number(value)] ?? '' : cell.getAttribute('t') === 'inlineStr' ? cell.getElementsByTagName('is')[0]?.textContent ?? '' : value
   }
   return Array.from({ length: cells.length }, (_, index) => cells[index] ?? '')
  })
 } else throw new Error('請選擇 XLSX 或 UTF-8 CSV 檔案')
 return planSpreadsheet(table, xlsx)
}
export function planSpreadsheet(table: string[][], excelDates = false): SheetPreview {
 const headers = (table[0] ?? []).map(normalized)
 if (headers.filter(Boolean).length !== new Set(headers.filter(Boolean)).size) throw new Error('表格有重複欄名，請先修正')
 const indices = new Map(Object.entries(fields).map(([field, aliases]) => [field, headers.findIndex(header => aliases.some(alias => normalized(alias) === header))]))
 if ((indices.get('title') ?? -1) < 0) throw new Error('第一列需要「書名」欄位')
 const extraColumns = (table[0] ?? []).filter((_, index) => ![...indices.values()].includes(index))
 const list = (text: string) => text.split(/[、;；\n]/).map(s => s.trim()).filter(Boolean)
 const rows = table.slice(1).filter(row => row.some(cell => cell.trim())).map((cells, index): SheetBook => {
  const get = (field: string) => cells[indices.get(field) ?? -1]?.trim() ?? ''
  const title = get('title'); if (!title) throw new Error(`第 ${index + 2} 列沒有書名`)
  const types: Record<string, BookDraft['bookForm']> = { 小說: 'novel', 漫畫: 'manga', 雜誌: 'magazine', 網文: 'webNovel', 網路小說: 'webNovel' }
  const type = get('type'); if (type && !types[type]) throw new Error(`《${title}》類型請使用小說／漫畫／雜誌／網文`)
  const statuses: Record<string, ReadingCycleStatus> = { 待讀: 'planned', 尚未開始: 'planned', 未讀: 'planned', 閱讀中: 'reading', 在讀: 'reading', 已完讀: 'completed', 已讀完: 'completed', 讀完: 'completed', 暫停: 'paused', 棄讀: 'abandoned' }
  const rawStatus = get('status'); if (rawStatus && !statuses[rawStatus]) throw new Error(`《${title}》閱讀狀態無法辨識`)
  let completedOn = get('date') || null
  if (completedOn && excelDates && /^\d+(\.\d+)?$/.test(completedOn) && Number(completedOn) > 0 && Number(completedOn) < 2958466) completedOn = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(completedOn)) * 86400000).toISOString().slice(0, 10)
  if (completedOn && (!/^\d{4}-\d{2}-\d{2}$/.test(completedOn) || Number.isNaN(Date.parse(completedOn)) || new Date(completedOn).toISOString().slice(0, 10) !== completedOn)) throw new Error(`《${title}》完讀日期請使用 YYYY-MM-DD`)
  const status = rawStatus ? statuses[rawStatus] : completedOn ? 'completed' : null
  if (completedOn && status !== 'completed') throw new Error(`《${title}》完讀日期與閱讀狀態不同，請核對`)
  const cover = get('cover'); if (cover && !/^https:\/\//i.test(cover)) throw new Error(`《${title}》封面需為 HTTPS 圖片網址`)
  return { row: index + 2, draft: { title, mediaTypeId: 'ebook', bookForm: types[type] ?? 'other', authorNames: list(get('author')), publisherName: get('publisher'), isbn: get('isbn'), bookNote: get('note'), cover: cover ? { path: cover, mimeType: 'image/jpeg' } : null }, status, completedOn, review: get('review'), categories: list(get('categories')), tags: list(get('tags')), sources: list(get('sources')) }
 })
 if (!rows.length || rows.length > 1000) throw new Error('每個檔案請包含 1～1000 本書')
 return { rows, extraColumns }
}
async function writeRow(repositories: ReadingCenterRepositories, row: SheetBook) {
 const ids = async (kind: 'category' | 'tag' | 'source', names: string[]) => {
  const entries = await repositories.dictionaries.getAll(), result: string[] = []
  for (const name of names) {
   const previous = entries.find(entry => entry.kind === kind && normalized(entry.name) === normalized(name))
   if (previous) { result.push(previous.id); continue }
   const entry = { ...createMetadata({ id: crypto.randomUUID(), now: new Date().toISOString() }), kind, name, color: null }
   await repositories.dictionaries.save(entry); entries.push(entry); result.push(entry.id)
  }
  return result
 }
 const categoryIds = await ids('category', row.categories), tagIds = await ids('tag', row.tags), sourceIds = await ids('source', row.sources)
 const book = await new BookService(repositories).create({ ...row.draft, categoryIds, tagIds })
 if (sourceIds.length) await repositories.books.save(updateEntity(book, { sourceIds }, new Date().toISOString()))
 if (row.status) await new ReadingCycleService(repositories).create(book.id, { status: row.status, completionDate: row.completedOn ? { precision: 'date', completedOn: row.completedOn } : null })
 if (row.review) await new ReadingContentService(repositories).create(book.id, { type: 'shortReview', text: row.review })
}
export async function importSpreadsheet(repositories: ReadingCenterRepositories, preview: SheetPreview): Promise<{ added: number; skipped: number }> {
 // Validate every row against the same domain services before any destination writes.
 const staging = createInMemoryRepositories()
 for (const row of preview.rows) await writeRow(staging, row)
 if (!repositories.transaction) throw new Error('此裝置無法安全批次匯入，請重新開啟網頁')
 return repositories.transaction(async () => {
  const titles = new Set((await repositories.books.getAll()).map(book => normalized(getBookDisplayTitle(book))))
  let added = 0, skipped = 0
  for (const row of preview.rows) {
   const key = normalized(row.draft.title)
   if (titles.has(key)) { skipped++; continue }
   await writeRow(repositories, row); titles.add(key); added++
  }
  return { added, skipped }
 })
}
