import { expect, it } from 'vitest'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data'
import type { StoredRemoteEntity } from '../../src/server/entity-api'
import { auditNotionIntegrity, createNotionAuditSnapshot } from '../../src/import/notion-integrity-audit'

async function fixture() {
  const hash = 'a'.repeat(64), externalId = `${hash}:2`
  const book = await new BookService(createInMemoryRepositories(), () => `notion:book:${externalId}`).create({ title: '核對測試', mediaTypeId: 'book' })
  book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId, importedAt: book.createdAt }
  const raw = Object.fromEntries(['書名', 'Created time', 'Rollup', 'TD', '一行心得', '主題', '作者', '來源', '出版社', '喜好', '完', '封面', '年度', '心得', '時間', '標籤', '紀錄表', '綜合筆記倉庫', '網址', '評分', '讀完', '閱聽統計表', '閱讀', '閱讀時間', '關聯生活點滴'].map(k => [k, '']))
  Object.assign(raw, { 書名: book.title, 一行心得: '第一行\n第二行', 主題: '社會議題, 報導文學', 來源: '讀墨', 出版社: '尖端出版', 評分: '4', 喜好: '★★★★', 心得: 'Yes', 綜合筆記倉庫: '筆記連結', 閱讀: '已讀完', 時間: '2025/01/15 下午9:16 (GMT+8)', 閱讀時間: '總共閱讀7天' })
  const notes = () => { book.importSourceNotes = 'Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n' + Object.entries(raw).map(([k, v]) => `${k}：${v}`).join('\n') + '\n來源標示有長篇心得；CSV 沒有正文，正文尚未搬入。' }
  notes()
  book.rating = { value: 4, scale: 5 }; book.publisherId = 'pub'; book.sourceIds = ['source']; book.categoryIds = ['category1', 'category2']
  const entity = (kind: string, id: string, payload: unknown) => ({ kind, id, deletedAt: null, payload }) as StoredRemoteEntity
  const stored = entity('book', book.id, book)
  const dictionaries = [entity('dictionary', 'pub', { kind: 'publisher', name: '尖端' }), entity('dictionary', 'source', { kind: 'source', name: '讀墨' }), entity('dictionary', 'category1', { kind: 'category', name: '報導文學' }), entity('dictionary', 'category2', { kind: 'category', name: '社會議題' })]
  const contents = [entity('readingContent', `notion:short-review:${externalId}`, { bookId: book.id, type: 'shortReview', text: raw['一行心得'] })]
  const cycles = [entity('readingCycle', `notion:cycle:${externalId}`, { bookId: book.id, status: 'completed', completionDate: { precision: 'minute', completedOn: '2025-01-15', localTime: '21:16', offsetMinutes: 480 }, reportedReadingDays: 7 })]
  return { book, stored, dictionaries, contents, cycles, raw, notes }
}
it('matches normalized publishers, unordered categories, multiline reviews, exact date precision and source days without mutation', async () => {
  const f = await fixture(), before = JSON.stringify(f)
  const r = auditNotionIntegrity([f.stored], f.dictionaries, f.contents, f.cycles)
  expect(r).toMatchObject({ books: 1, checked: 1, uncheckable: 0, longReviewFlags: 1, relatedNoteLinks: 1 })
  for (const field of ['評分', '出版社', '來源', '分類', '短評', '完讀日期', '閱讀天數', '閱讀狀態'] as const) expect(r.fields[field]['相符']).toBe(1)
  expect(r.fields['標籤']['原始空白']).toBe(1)
  expect(JSON.stringify(f)).toBe(before)
})
it('separates absent formal fields, later edits and intentional deletion', async () => {
  const f = await fixture()
  f.book.rating = { value: 3, scale: 5 }; f.book.publisherId = null
  f.contents[0].deletedAt = '2026-10-03T00:00:00Z'
  const r = auditNotionIntegrity([f.stored], f.dictionaries, f.contents, [])
  expect(r.fields['評分']['內容不同']).toBe(1)
  expect(r.fields['出版社']['正式欄位缺少']).toBe(1)
  expect(r.fields['短評']['已刪除']).toBe(1)
  expect(r.fields['完讀日期']['正式欄位缺少']).toBe(1)
})
it('does not invent missing dates or reading cycles for explicitly unstarted books', async () => {
  const f = await fixture()
  Object.assign(f.raw, { 閱讀: '尚未開始', 時間: '', 閱讀時間: '總共閱讀0天' }); f.notes()
  const r = auditNotionIntegrity([f.stored], f.dictionaries, f.contents, [])
  for (const field of ['完讀日期', '閱讀天數', '閱讀狀態'] as const) expect(r.fields[field]['原始空白']).toBe(1)
  f.raw['閱讀'] = '已讀完'; f.raw['閱讀時間'] = '總共閱讀7天'; f.notes()
  expect(auditNotionIntegrity([f.stored], f.dictionaries, f.contents, f.cycles).fields['完讀日期']['原始空白']).toBe(1)
})
it('keeps malformed or multirow sources outside the match counts, and labels contradictory source dates separately', async () => {
  const f = await fixture()
  f.book.importSourceNotes += '\n【來源第 3 列】\n書名：別本'
  expect(auditNotionIntegrity([f.stored], f.dictionaries, f.contents, f.cycles)).toMatchObject({ checked: 0, uncheckable: 1 })
  f.raw['閱讀'] = '暫停'; f.notes()
  expect(auditNotionIntegrity([f.stored], f.dictionaries, f.contents, f.cycles).fields['完讀日期']['需另判定']).toBe(1)
})

it('does not label an unnamed source row without reading evidence as lost cycle data', async () => {
  const f = await fixture()
  Object.assign(f.raw, { 書名: '', 閱讀: '暫停', 時間: '', 關聯生活點滴: '', 閱讀時間: '總共閱讀0天' }); f.notes()
  const r = auditNotionIntegrity([f.stored], f.dictionaries, f.contents, [])
  expect(r.fields['閱讀狀態']['正式欄位缺少']).toBe(0)
  expect(r.fields['閱讀狀態']['需另判定']).toBe(1)
  expect(r.details.find(item => item.field === '閱讀狀態')?.reason).toContain('原始書名空白')
  f.raw['時間'] = '2025/01/15'; f.notes()
  expect(auditNotionIntegrity([f.stored], f.dictionaries, f.contents, []).fields['閱讀狀態']['正式欄位缺少']).toBe(1)
})
it('identifies absent preserved source notes without declaring formal data lost', async () => {
  const f = await fixture()
  f.book.importSourceNotes = ''
  const r = auditNotionIntegrity([f.stored], f.dictionaries, f.contents, f.cycles)
  expect(r.uncheckable).toBe(1)
  expect(r.details[0].reason).toContain('未保留可核對的來源原文')
  expect(r.details[0].reason).toContain('不能據此判定正式資料遺失')
})

it('uses an exact snapshot identity to audit a pilot without notes and reports unmigrated and deleted source rows', async () => {
  const f = await fixture()
  f.book.importSourceNotes = ''
  const id = f.book.provenance.kind === 'import' ? f.book.provenance.externalId : ''
  const snapshot = { csvSha256: id.split(':')[0], rows: new Map([[id, f.raw], [id.replace(':2', ':3'), { ...f.raw, 書名: '尚未搬入' }], [id.replace(':2', ':4'), { ...f.raw, 書名: '已刪除' }]]) }
  const deleted: StoredRemoteEntity = { ...f.stored, id: `notion:book:${id.replace(':2', ':4')}`, deletedAt: '2026-10-04T00:00:00Z', payload: null }
  const before = JSON.stringify([f.stored, deleted])
  const r = auditNotionIntegrity([f.stored, deleted], f.dictionaries, f.contents, f.cycles, snapshot)
  expect(r).toMatchObject({ checked: 1, uncheckable: 0, coverage: { total: 3, present: 1, deleted: 1, missing: 1 } })
  expect(r.fields['短評']['相符']).toBe(1)
  expect(JSON.stringify([f.stored, deleted])).toBe(before)
  expect(() => auditNotionIntegrity([f.stored], [], [], [], { csvSha256: 'b'.repeat(64), rows: new Map([['b'.repeat(64) + ':2', f.raw]]) })).toThrow('不相符')
})
it('validates all original CSV columns and hashes BOM consistently with migration', async () => {
  const f = await fixture()
  const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"'
  const csv = Object.keys(f.raw).map(quote).join(',') + '\n' + Object.values(f.raw).map(quote).join(',')
  const first = await createNotionAuditSnapshot(csv), second = await createNotionAuditSnapshot('\uFEFF' + csv)
  expect(second.csvSha256).toBe(first.csvSha256)
  expect(first.rows.get(first.csvSha256 + ':2')?.['一行心得']).toBe('第一行\n第二行')
  await expect(createNotionAuditSnapshot('書名\n測試')).rejects.toThrow('不完整')
})
