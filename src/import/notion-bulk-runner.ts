import type { BookCover } from '../domain'
import { buildNotionBulkBatch, stageNotionBulkImport } from './notion-bulk-batch'
import type { buildNotionImportPlan } from './notion-import-plan'
import type { openNotionZip } from './notion-zip-reader'

export interface NotionMigrationReport {
  csvSha256: string
  total: number
  inserted: number
  existing: number
  issues: { rows: number[]; message: string }[]
  coverWarnings: { rows: number[]; message: string }[]
  stopped: boolean
}

export async function runNotionBulkImport(plan: ReturnType<typeof buildNotionImportPlan>, zip: Awaited<ReturnType<typeof openNotionZip>> | null, options: {
  existingWorkKeys?: ReadonlySet<string>
  signal: AbortSignal
  fetch?: typeof fetch
  onProgress: (report: NotionMigrationReport) => void
}) {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis)
  const staging = stageNotionBulkImport(plan)
  const groups = staging.workGroups
  const report: NotionMigrationReport = { csvSha256: plan.csvSha256, total: groups.length, inserted: 0, existing: 0, issues: [], coverWarnings: [], stopped: false }
  for (const group of groups) {
    if (options.signal.aborted) { report.stopped = true; break }
    const rows = group.sourceRowNumbers
    if (options.existingWorkKeys?.has(group.stagingKey)) {
      report.existing++
      options.onProgress({ ...report, issues: [...report.issues], coverWarnings: [...report.coverWarnings] })
      continue
    }
    try {
      let cover: BookCover | undefined
      let warning: string | undefined
      if (group.coverReferences.length) {
        const refs = [...new Map(group.coverReferences.map((ref) => [`${ref.kind}:${ref.value}`, ref])).values()]
        if (refs.length !== 1 || refs[0].kind !== 'local-export-file' || !zip) warning = '封面引用已保留；缺少 ZIP、多張封面或外部圖片尚未搬入'
        else {
          try {
            const bytes = await zip.readImage(refs[0].value)
            const mimeType = /\.png$/i.test(refs[0].value) ? 'image/png' : /\.webp$/i.test(refs[0].value) ? 'image/webp' : /\.avif$/i.test(refs[0].value) ? 'image/avif' : 'image/jpeg'
            const response = await request('/api/v1/covers/notion', { method: 'POST', credentials: 'include', signal: options.signal, headers: { 'Content-Type': mimeType, 'X-Book-Id': `notion:book:${group.stagingKey}`, 'X-Book-Title': encodeURIComponent(group.title || `Notion 第 ${rows[0]} 列`) }, body: new Blob([Uint8Array.from(bytes)], { type: mimeType }) })
            if (!response.ok) throw new MigrationHttpError(response.status, '封面上傳未成功')
            const value = await response.json()
            const stored = value?.data?.cover
            if (!stored || typeof stored.path !== 'string' || stored.mimeType !== mimeType) throw new Error('封面回應無效')
            cover = stored
          } catch (error) {
            if (error instanceof MigrationHttpError || options.signal.aborted || error instanceof TypeError) throw error
            warning = error instanceof Error ? error.message : '封面無法讀取，引用已保留'
          }
        }
      }
      const items = buildNotionBulkBatch(plan, rows, new Date().toISOString(), cover, staging)
      if (warning) {
        const book = items.find((item) => item.kind === 'book')!
        book.entity.importSourceNotes = (book.entity.importSourceNotes ?? '') + `\n封面搬遷提醒：${warning}`
      }
      const response = await request('/api/v1/import/notion/batch', { method: 'POST', credentials: 'include', signal: options.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ csvSha256: plan.csvSha256, items }) })
      const value = await response.json()
      if (!response.ok) throw new MigrationHttpError(response.status, value?.error?.message || `匯入失敗（${response.status}）`)
      if (value?.data?.status === 'inserted') report.inserted++
      else if (value?.data?.status === 'already-applied') report.existing++
      else throw new MigrationHttpError(500, '回應無法確認；停止並保留已完成資料，可重新執行')
      if (warning && value.data.status === 'inserted') report.coverWarnings.push({ rows, message: warning })
    } catch (error) {
      if (!options.signal.aborted) report.issues.push({ rows, message: error instanceof Error ? error.message : '匯入失敗' })
      if (options.signal.aborted || !(error instanceof MigrationHttpError) || error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500) {
        report.stopped = true
        break
      }
    } finally { options.onProgress({ ...report, issues: [...report.issues], coverWarnings: [...report.coverWarnings] }) }
  }
  return report
}

class MigrationHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}
