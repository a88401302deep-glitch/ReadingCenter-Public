import type { NotionBatchItem } from '../src/import/notion-pilot-batch'
import type { CoverKV, D1Database } from './cloudflare-types'
import { insertNotionPilotBatch, type AtomicD1Database } from './notion-import-batch'

const noStore = { 'Cache-Control': 'no-store' }
const maximumBytes = 128 * 1024

/** Called by the Worker only after session authentication and the import feature gate. */
export async function handleNotionPilotApi(request: Request, db: D1Database, covers?: CoverKV, migration = false): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: { code: 'method_not_allowed' } }, { status: 405, headers: noStore })
  if (!('batch' in db) || typeof db.batch !== 'function') {
    return Response.json({ error: { code: 'database_unavailable' } }, { status: 503, headers: noStore })
  }
  const length = Number(request.headers.get('Content-Length'))
  if (length > maximumBytes) return invalid('Pilot request is too large', 413)
  let value: unknown
  try {
    const raw = await request.text()
    if (new TextEncoder().encode(raw).length > maximumBytes) return invalid('Pilot request is too large', 413)
    value = JSON.parse(raw)
  } catch { return invalid('Pilot request must be valid JSON') }
  if (!isObject(value) || typeof value.csvSha256 !== 'string' || !Array.isArray(value.items) ||
    value.items.some((item) => !isObject(item) || !['book', 'dictionary', 'readingCycle', 'readingContent'].includes(String(item.kind)) || !isObject(item.entity))) {
    return invalid('Pilot request has invalid items')
  }
  try {
    const result = await insertNotionPilotBatch(db as AtomicD1Database, value.csvSha256, value.items as NotionBatchItem[], covers, migration)
    return Response.json({ data: result }, { status: result.status === 'inserted' ? 201 : 200, headers: noStore })
  } catch (error) {
    if (error instanceof Error && /^(Invalid pilot|Pilot batch|Pilot entity|Pilot cover|Book requires|Cycle does|Review does|Existing dictionary|Existing same-title|Notion source row|Existing pilot entity|Partial pilot batch)/.test(error.message)) {
      return invalid(error.message, 409)
    }
    return Response.json({ error: { code: 'import_failed', message: 'Pilot import failed; check the database before retrying' } }, { status: 500, headers: noStore })
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function invalid(message: string, status = 400): Response {
  return Response.json({ error: { code: status === 409 ? 'import_conflict' : 'invalid_request', message } }, { status, headers: noStore })
}
