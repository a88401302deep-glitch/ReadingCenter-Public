import { useEffect, useRef, useState } from 'react'
import { assertValidBook, type Book } from '../../domain'
import { prepareNotionCoverBackfill, runNotionCoverBackfill, type CoverBackfillPlan, type CoverBackfillReport } from '../../import/notion-cover-backfill'
import type { buildNotionImportPlan } from '../../import/notion-import-plan'
import type { openNotionZip } from '../../import/notion-zip-reader'
import { CloudflareEntityClient } from '../../sync/cloudflare/entity-client'
import { Button } from '../../shared/ui/Button'

export function NotionCoverBackfill({ plan, zip, remoteEnabled }: { remoteEnabled: boolean; plan: ReturnType<typeof buildNotionImportPlan>; zip: Awaited<ReturnType<typeof openNotionZip>> | null }) {
  const [previewState, setPreview] = useState<{ zip: typeof zip; data: CoverBackfillPlan } | null>(null)
  const preview = previewState?.zip === zip ? previewState.data : null
  const [report, setReport] = useState<CoverBackfillReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [zip])
  const compare = async () => {
    if (!remoteEnabled || !zip || controller.current) return
    const active = new AbortController(); controller.current = active; setBusy(true); setError(null); setPreview(null); setReport(null)
    try {
      const stored = await new CloudflareEntityClient('', fetch, active.signal).list('book')
      const books = stored.map((item) => {
        if (!item.payload || item.deletedAt || item.kind !== 'book' || item.payload.id !== item.id) throw new Error('正式書籍資料不完整，未開始補封面')
        const book = item.payload as unknown as Book
        assertValidBook(book)
        return { ...book, revision: item.revision }
      })
      const result = await prepareNotionCoverBackfill(plan, zip, books)
      if (!active.signal.aborted) setPreview({ zip, data: result })
    } catch (cause) { if (!active.signal.aborted) setError(cause instanceof Error ? cause.message : '封面比對失敗') }
    finally { controller.current = null; setBusy(false) }
  }
  const start = async () => {
    if (!remoteEnabled || !zip || !preview || controller.current) return
    const active = new AbortController(); controller.current = active; setBusy(true); setError(null)
    try { setReport(await runNotionCoverBackfill(preview, zip, { signal: active.signal, onProgress: setReport })); setPreview(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '補封面失敗') }
    finally { controller.current = null; setBusy(false) }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report ?? preview, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = `notion-cover-result-${plan.csvSha256.slice(0, 12)}.json`
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section aria-label="已匯入書籍批次補封面">
    <h3>已匯入書籍批次補封面</h3>
    <p>沿用原本匯入的 CSV，載入上方 Notion 封面 ZIP。先比對已匯入書籍，再一次補上可唯一對應的封面；已有封面會保留，不新增書籍。</p>
    <p>ZIP 的書籍資料只允許封面路徑不同。多張候選、外部網址或缺少圖片列入報告，不需要逐本確認。</p>
    <div className="notion-review-actions"><Button disabled={!remoteEnabled || !zip || busy} onClick={() => void compare()}>比對補封面</Button>{preview && <Button disabled={!remoteEnabled || busy || !preview.candidates.length} onClick={() => void start()}>確認批次補封面</Button>}{busy && <Button onClick={() => controller.current?.abort()}>停止</Button>}{(preview || report) && <Button onClick={download}>下載封面結果</Button>}</div>
    {error && <p role="alert">{error}</p>}
    {preview && <p role="status">可補 {preview.candidates.length} 本；已有封面保留 {preview.preserved} 筆；來源沒有封面 {preview.noReference} 筆；需另處理 {preview.issues.length} 筆。尚未寫入。</p>}
    {report && <p role="status">{busy ? '補封面中' : report.stopped ? '已停止，可重新比對接續' : '本次補封面結束'}：已補 {report.added} 本；已有封面保留 {report.preserved} 筆；需另處理 {report.issues.length} 筆。此批可補共 {report.total} 本。</p>}
  </section>
}
