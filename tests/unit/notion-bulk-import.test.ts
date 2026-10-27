import { describe, expect, it, vi } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { buildNotionBulkBatch, stageNotionBulkImport } from '../../src/import/notion-bulk-batch'
import { runNotionBulkImport } from '../../src/import/notion-bulk-runner'

const hash = 'a'.repeat(64)
const now = '2026-10-01T00:00:00Z'
const completeCsv = (csv: string) => {
  const lines = csv.split('\n')
  const headers = lines[0].split(',')
  const missing = ['書名', '作者', '閱讀', '評分', '主題', '標籤', '時間', '一行心得'].filter((name) => !headers.includes(name))
  return [lines[0] + missing.map((name) => `,${name}`).join(''), ...lines.slice(1).map((line) => line + ','.repeat(missing.length))].join('\n')
}
const planFor = (csv: string) => buildNotionImportPlan(hash, normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(completeCsv(csv))), {})
const twoBooks = () => planFor('書名,閱讀,時間\n第一本,已讀完,2024/02/25\n第二本,閱讀中,')

describe('one-time Notion bulk migration', () => {
  it('retains missing titles, ambiguous source fields and long-review flags without invented reading records', () => {
    const plan = planFor('書名,作者,閱讀,出版社,心得,網址,時間\n,作者：未確認,棄坑,原始出版社,Yes,https://example.test/book,')
    const items = buildNotionBulkBatch(plan, [2], now)
    const book = items.find((item) => item.kind === 'book')!
    expect(book.entity.title).toBe('未命名（Notion 來源第 2 列）')
    expect(book.entity.bookNote).toBe('')
    expect(book.entity.importSourceNotes).toContain('作者：未確認')
    expect(book.entity.importSourceNotes).toContain('https://example.test/book')
    expect(book.entity.importSourceNotes).toContain('正文尚未搬入')
    expect(items.some((item) => item.kind === 'readingCycle')).toBe(false)
    expect(items.filter((item) => item.kind === 'dictionary' && item.entity.kind === 'mediaType')[0].entity.id).toBe(book.entity.mediaTypeId)
  })

  it('keeps unconfirmed same-work proposals separate and preserves explicit prior status decisions', () => {
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(completeCsv('書名,作者,閱讀,時間\n同名,作者,閱讀中,2024/02/25\n同名,作者,閱讀中,2024/02/25')))
    const decisions = { 2: { date: 'keep-source' as const, duplicate: 'same-work' as const }, 3: { date: 'keep-source' as const, duplicate: 'same-work' as const } }
    const plan = buildNotionImportPlan(hash, rows, decisions, [], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }])
    expect(stageNotionBulkImport(plan).workGroups).toHaveLength(2)
    const items = buildNotionBulkBatch(plan, [2], now)
    const cycle = items.find((item) => item.kind === 'readingCycle')!
    expect(cycle.entity).toMatchObject({ status: 'reading', completionDate: null })
  })

  it('automatically continues per-row conflicts and reports them', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: { message: '來源已連到其他書籍' } }, { status: 409 }))
      .mockResolvedValueOnce(Response.json({ data: { status: 'inserted' } }, { status: 201 }))
    const report = await runNotionBulkImport(twoBooks(), null, { signal: new AbortController().signal, fetch: request, onProgress: () => {} })
    expect(report).toMatchObject({ inserted: 1, existing: 0, stopped: false, issues: [{ rows: [2], message: '來源已連到其他書籍' }] })
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('stops on lost session and reports confirmed progress for resumable retry', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ data: { status: 'already-applied' } }))
      .mockResolvedValueOnce(Response.json({ error: { message: '請登入' } }, { status: 401 }))
    const report = await runNotionBulkImport(twoBooks(), null, { signal: new AbortController().signal, fetch: request, onProgress: () => {} })
    expect(report).toMatchObject({ inserted: 0, existing: 1, stopped: true })
  })

  it('stops after cancellation and preserves confirmed inserts', async () => {
    const controller = new AbortController()
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { status: 'inserted' } }, { status: 201 }))
    const report = await runNotionBulkImport(twoBooks(), null, { signal: controller.signal, fetch: request, onProgress: () => controller.abort() })
    expect(report).toMatchObject({ inserted: 1, stopped: true })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('preserves unavailable cover references in the book and report without a per-row prompt', async () => {
    const plan = planFor('書名,封面\n測試,missing.jpg')
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { status: 'inserted' } }, { status: 201 }))
    const report = await runNotionBulkImport(plan, null, { signal: new AbortController().signal, fetch: request, onProgress: () => {} })
    expect(report.coverWarnings).toHaveLength(1)
    const body = JSON.parse(request.mock.calls[0][1]!.body as string)
    expect(body.items.find((item: { kind: string }) => item.kind === 'book').entity.importSourceNotes).toContain('missing.jpg')
    expect(report.inserted).toBe(1)
  })
})
