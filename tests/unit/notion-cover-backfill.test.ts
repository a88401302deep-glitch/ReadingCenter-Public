import { describe, expect, it, vi } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { buildNotionBulkBatch } from '../../src/import/notion-bulk-batch'
import { matchCoverExport, prepareNotionCoverBackfill, runNotionCoverBackfill } from '../../src/import/notion-cover-backfill'

const hash = 'a'.repeat(64)
const csv = '書名,作者,閱讀,評分,主題,標籤,時間,一行心得,封面\n同名,作者,已讀完,,,,2024/02/25,,old.jpg\n同名,作者,已讀完,,,,2024/03/25,,old2.jpg'
const exported = csv.replace('old.jpg', 'new.jpg').replace('old2.jpg', 'new2.jpg')
const plan = buildNotionImportPlan(hash, normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv)), {})
const books = [2, 3].map((row) => buildNotionBulkBatch(plan, [row], '2026-10-02T00:00:00.000Z').find((item) => item.kind === 'book')!.entity)
const zip = () => ({ filenames: ['books_all.csv', 'new.jpg', 'new2.jpg'], readCsv: vi.fn().mockResolvedValue(exported), readImage: vi.fn().mockResolvedValue(new Uint8Array([255, 216, 255, 217])) })

describe('Notion cover-only backfill', () => {
  it('accepts only cover-path differences, rejecting changed fields and row reordering', () => {
    expect(matchCoverExport(plan, exported)).toHaveLength(2)
    expect(() => matchCoverExport(plan, exported.replace('2024/02/25', '2025/02/25'))).toThrow('內容或列順序不符')
    expect(() => matchCoverExport(plan, exported.split('\n').map((row, i, rows) => i === 1 ? rows[2] : i === 2 ? rows[1] : row).join('\n'))).toThrow('內容或列順序不符')
  })

  it('matches source identities rather than titles and preserves existing covers', async () => {
    const result = await prepareNotionCoverBackfill(plan, zip(), [{ ...books[0], cover: { path: 'manual.jpg', mimeType: 'image/jpeg' } }, books[1]])
    expect(result).toMatchObject({ preserved: 1, candidates: [{ bookId: books[1].id, rowNumber: 3, filename: 'new2.jpg' }] })
    expect(result.candidates).toHaveLength(1)
    expect(books[1].cover).toBeNull()
  })

  it('leaves multiple pictures and external references in the report without guessing', async () => {
    const archive = zip()
    // Quote a CSV cell containing multiple references.
    archive.readCsv.mockResolvedValue(exported.replace(',,new.jpg', ',,"new.jpg, new2.jpg"').replace(',,new2.jpg', ',,https://example.test/cover.jpg'))
    const result = await prepareNotionCoverBackfill(plan, archive, books)
    expect(result.candidates).toHaveLength(0)
    expect(result.issues).toHaveLength(2)
  })

  it('uploads and attaches covers to existing books without sending book fields', async () => {
    const archive = zip(); const preview = await prepareNotionCoverBackfill(plan, archive, books)
    const request = vi.fn<typeof fetch>().mockImplementation(async (path) => String(path).endsWith('/covers/notion')
      ? Response.json({ data: { cover: { path: 'stored.jpg', mimeType: 'image/jpeg' } } }) : Response.json({ data: { status: 'added' } }))
    const report = await runNotionCoverBackfill(preview, archive, { signal: new AbortController().signal, fetch: request, onProgress: () => {} })
    expect(report).toMatchObject({ added: 2, stopped: false })
    const body = JSON.parse(request.mock.calls[1][1]!.body as string)
    expect(body).toMatchObject({ bookId: books[0].id, csvSha256: hash, rowNumber: 2, baseRevision: 1 })
    expect(body.entity).toBeUndefined()
    expect(request.mock.calls.every(([path]) => String(path) !== '/api/v1/import/notion/batch')).toBe(true)
  })

  it('stops once on authentication or uncertain responses and supports retry with newly covered books skipped', async () => {
    const archive = zip(); const preview = await prepareNotionCoverBackfill(plan, archive, books)
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: { message: '請登入' } }, { status: 401 }))
    const result = await runNotionCoverBackfill(preview, archive, { signal: new AbortController().signal, fetch: request, onProgress: () => {} })
    expect(result).toMatchObject({ added: 0, stopped: true })
    expect(request).toHaveBeenCalledTimes(1)
    const retried = await prepareNotionCoverBackfill(plan, archive, books.map((book) => ({ ...book, cover: { path: 'already.jpg', mimeType: 'image/jpeg' } })))
    expect(retried.candidates).toHaveLength(0)
    expect(retried.preserved).toBe(2)
  })
})
