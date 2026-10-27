import { StoreConflictError, type RemoteEntityStore } from '../src/server/entity-api'
import type { BookCover } from '../src/domain'
import type { CoverKV } from './cloudflare-types'
import { verifyStoredPilotCover } from './cover-assets'

const headers = { 'Cache-Control': 'no-store' }
const error = (message: string, status: number) => Response.json({ error: { code: 'cover_backfill_failed', message } }, { status, headers })

/** Authenticated, cover-only update. The server owns the current book payload. */
export async function handleNotionCoverBackfill(request: Request, store: RemoteEntityStore, covers?: CoverKV): Promise<Response> {
  if (request.method !== 'POST') return error('不支援的操作', 405)
  if (Number(request.headers.get('Content-Length')) > 4096) return error('請求過大', 413)
  let input
  try { const raw = await request.text(); if (new TextEncoder().encode(raw).length > 4096) return error('請求過大', 413); input = JSON.parse(raw) } catch { return error('請求格式不符', 400) }
  if (!input || typeof input.bookId !== 'string' || !/^notion:book:[0-9a-f]{64}:\d+$/.test(input.bookId) ||
    !/^[0-9a-f]{64}$/.test(input.csvSha256) || !Number.isSafeInteger(input.rowNumber) || input.rowNumber < 2 ||
    !Number.isSafeInteger(input.baseRevision) || input.baseRevision < 1 || typeof input.mutationId !== 'string' || !/^[\w-]{1,100}$/.test(input.mutationId) ||
    !input.cover || typeof input.cover.path !== 'string' || typeof input.cover.mimeType !== 'string') return error('封面或來源識別不符', 400)
  try {
    const current = await store.get('book', input.bookId)
    if (!current || current.deletedAt || !current.payload) return error('書籍不存在或已刪除，未補封面', 404)
    const book = current.payload
    const key = `${input.csvSha256}:${input.rowNumber}`
    const linked = book.provenance.kind === 'import' && book.provenance.sourceId === 'notion-csv-snapshot' && book.provenance.externalId === key ||
      Array.isArray(book.externalReferences) && book.externalReferences.some((ref) => ref && typeof ref === 'object' && ref.sourceId === 'notion-csv-snapshot' && ref.externalId === key)
    if (!linked) return error('來源未連到這本書，未補封面', 409)
    if (book.cover) return Response.json({ data: { status: 'already-covered' } }, { headers })
    if (current.revision !== input.baseRevision) return error('書籍已變更，請重新比對後接續', 409)
    try { await verifyStoredPilotCover(covers, input.bookId, input.cover as BookCover) } catch { return error('封面檔案未通過書籍與內容核對', 409) }
    await store.put({ kind: 'book', mutationId: input.mutationId, baseRevision: current.revision, entity: { ...book, cover: { path: input.cover.path, mimeType: input.cover.mimeType }, updatedAt: new Date().toISOString() } })
    return Response.json({ data: { status: 'added' } }, { headers })
  } catch (cause) {
    return cause instanceof StoreConflictError ? error('書籍已變更，請重新比對後接續', 409) : error('補封面結果無法確認，請停止後重新比對', 500)
  }
}
