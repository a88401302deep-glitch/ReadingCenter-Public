import { useEffect, useRef, useState } from 'react'
import { prepareNotionCompletionBackfill, runNotionCompletionBackfill, type CompletionBackfillPlan, type CompletionBackfillReport } from '../../import/notion-completion-backfill'
import { CloudflareEntityClient } from '../../sync/cloudflare/entity-client'
import { Button } from '../../shared/ui/Button'

export function NotionCompletionBackfill({ onUpdated }: { onUpdated: () => void }) {
  const [plan, setPlan] = useState<CompletionBackfillPlan | null>(null)
  const [report, setReport] = useState<CompletionBackfillReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const execute = async (write: boolean) => {
    if (controller.current || (write && !plan)) return
    const active = new AbortController(); controller.current = active; setBusy(true); setError(null)
    const client = new CloudflareEntityClient('', fetch, active.signal)
    try {
      if (write && plan) {
        setPlan(null)
        const result = await runNotionCompletionBackfill(plan, client, active.signal, (value) => { if (!active.signal.aborted) setReport(value) })
        if (!active.signal.aborted) { setReport(result); onUpdated() }
      } else {
        setPlan(null); setReport(null)
        const [books, cycles] = await Promise.all([client.list('book'), client.list('readingCycle', true)])
        if (!active.signal.aborted) setPlan(prepareNotionCompletionBackfill(books, cycles))
      }
    } catch { if (!active.signal.aborted) setError('無法完成完讀補正，請確認登入與網路後重新比對。已補正的資料會保留。') }
    finally { controller.current = null; setBusy(false) }
  }
  return <section aria-label="Notion 批次補完讀狀態">
    <h3>Notion 批次補完讀狀態</h3>
    <p>補回來源明確標示已讀完、卻沒有日期或日誌關聯的閱讀週期。完讀日期維持空白，來源天數保留；不需要重選 CSV。已有或刪除過的閱讀週期會保留。</p>
    <Button disabled={busy} onClick={() => void execute(false)}>比對缺少的完讀狀態</Button>
    {plan && <><p role="status">可批次補 {plan.candidates.length} 本；已有閱讀週期保留 {plan.preserved} 本。尚未寫入。</p><details><summary>查看本批書籍</summary>{plan.candidates.map((item) => <p key={item.book.id}>{item.book.title}：已讀完，日期未提供</p>)}</details><Button disabled={busy || !plan.candidates.length} onClick={() => void execute(true)}>確認批次補完讀狀態</Button></>}
    {busy && <><p role="status">正在處理完讀狀態…</p><Button onClick={() => controller.current?.abort()}>停止</Button></>}
    {report && <><p role="status">{report.stopped ? '已停止，可重新比對接續' : busy ? '處理中' : '本批結束'}：已補 {report.added} 本；變動或已有週期保留 {report.skipped} 本；需另處理 {report.issues.length} 本。</p>{report.issues.map((item, index) => <p key={index}>{item.title}：{item.reason}</p>)}</>}
    {error && <p role="alert">{error}</p>}
  </section>
}
