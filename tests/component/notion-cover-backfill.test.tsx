// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotionCoverBackfill } from '../../src/features/import/NotionCoverBackfill'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { buildNotionBulkBatch } from '../../src/import/notion-bulk-batch'

const hash = 'a'.repeat(64)
const csv = '書名,作者,閱讀,評分,主題,標籤,時間,一行心得,封面\n測試,,已讀完,,,,2024/02/25,,old.jpg'
const plan = buildNotionImportPlan(hash, normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv)), {})
const book = buildNotionBulkBatch(plan, [2], '2026-10-02T00:00:00.000Z').find((item) => item.kind === 'book')!.entity
const zip = { filenames: ['books_all.csv', 'new.jpg'], readCsv: async () => csv.replace('old.jpg', 'new.jpg'), readImage: async () => new Uint8Array([255, 216, 255, 217]) }
afterEach(() => vi.unstubAllGlobals())
describe('existing books cover backfill entry', () => {
  it('compares without writes, then attaches all covers with one confirmation', async () => {
    const request = vi.fn<typeof fetch>().mockImplementation(async (path) => String(path).includes('/entities/book') ? Response.json({ data: [{ kind: 'book', id: book.id, revision: 1, createdAt: book.createdAt, updatedAt: book.updatedAt, schemaVersion: 1, provenance: book.provenance, deletedAt: null, payload: book }] })
      : String(path).endsWith('/covers/notion') ? Response.json({ data: { cover: { path: 'stored.jpg', mimeType: 'image/jpeg' } } }) : Response.json({ data: { status: 'added' } }))
    vi.stubGlobal('fetch', request)
    const { rerender } = render(<NotionCoverBackfill remoteEnabled={true} plan={plan} zip={zip} />)
    fireEvent.click(screen.getByRole('button', { name: '比對補封面' }))
    await screen.findByText(/可補 1 本.*尚未寫入/)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][1]?.method).toBeUndefined()
    rerender(<NotionCoverBackfill remoteEnabled={false} plan={plan} zip={zip} />)
    expect((screen.getByRole('button', { name: '確認批次補封面' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '確認批次補封面' }))
    expect(request).toHaveBeenCalledTimes(1)
    rerender(<NotionCoverBackfill remoteEnabled={true} plan={plan} zip={zip} />)
    fireEvent.click(screen.getByRole('button', { name: '確認批次補封面' }))
    await screen.findByText(/本次補封面結束：已補 1 本/)
    expect(request).toHaveBeenCalledTimes(3)
    expect(screen.getByRole('button', { name: '下載封面結果' })).toBeTruthy()
  })

  it('invalidates a preview when the selected archive changes', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: [{ kind: 'book', id: book.id, revision: 1, createdAt: book.createdAt, updatedAt: book.updatedAt, schemaVersion: 1, provenance: book.provenance, deletedAt: null, payload: book }] }))
    vi.stubGlobal('fetch', request)
    const { rerender } = render(<NotionCoverBackfill remoteEnabled={true} plan={plan} zip={zip} />)
    fireEvent.click(screen.getByRole('button', { name: '比對補封面' }))
    await screen.findByText(/可補 1 本/)
    rerender(<NotionCoverBackfill remoteEnabled={true} plan={plan} zip={{ ...zip }} />)
    expect(screen.queryByRole('button', { name: '確認批次補封面' })).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
