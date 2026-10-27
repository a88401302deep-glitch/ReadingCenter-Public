import { useEffect, useRef, useState } from 'react'
import { NOTION_MEDIA_LABELS, prepareNotionMediaBackfill, runNotionMediaBackfill, type MediaBackfillPlan, type MediaBackfillReport } from '../../import/notion-media-backfill'
import { CloudflareEntityClient } from '../../sync/cloudflare/entity-client'
import { Button } from '../../shared/ui/Button'

export function NotionMediaBackfill({ onUpdated }: { onUpdated: () => void }) {
  const [plan, setPlan] = useState<MediaBackfillPlan | null>(null)
  const [report, setReport] = useState<MediaBackfillReport | null>(null)
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
        const result = await runNotionMediaBackfill(plan, client, active.signal, (value) => { if (!active.signal.aborted) setReport(value) })
        if (!active.signal.aborted) { setReport(result); onUpdated() }
      } else {
        setPlan(null); setReport(null)
        const [books, dictionaries] = await Promise.all([client.list('book'), client.list('dictionary', true)])
        if (!active.signal.aborted) setPlan(prepareNotionMediaBackfill(books, dictionaries))
      }
    } catch { if (!active.signal.aborted) setError('無法完成媒體類型補正，請確認登入與網路後重新比對。已補正的資料會保留。') }
    finally { controller.current = null; setBusy(false) }
  }
  return <section aria-label="Notion 批次補媒體類型">
    <h3>Notion 批次補媒體類型</h3>
    <p>依原始分類補漫畫、網路小說、小說與雜誌；無法細分的先歸一般書籍，日後可再細分。保留原有分類與標籤，不需要重選 CSV。只補仍是未分類且分類未變更的書籍；明確類型互相衝突的維持未分類。</p>
    <Button disabled={busy} onClick={() => void execute(false)}>比對缺少的媒體類型</Button>
    {plan && <><p>{Object.entries(NOTION_MEDIA_LABELS).map(([key, name]) => `${name} ${plan.candidates.filter(item => item.mediaType === key).length} 本`).join('；')}</p><p role="status">可批次補 {plan.candidates.length} 本；已有類型或分類變動保留 {plan.preserved} 本；需另處理 {plan.unresolved.length} 本。尚未寫入。</p><details><summary>查看本批書籍</summary>{plan.candidates.map((item) => <p key={item.book.id}>{item.book.title}：{NOTION_MEDIA_LABELS[item.mediaType]}</p>)}</details><Button disabled={busy || !plan.candidates.length} onClick={() => void execute(true)}>確認批次補媒體類型</Button></>}
    {busy && <><p role="status">正在處理媒體類型…</p><Button onClick={() => controller.current?.abort()}>停止</Button></>}
    {report && <><p role="status">{report.stopped ? '已停止，可重新比對接續' : busy ? '處理中' : '本批結束'}：已補 {report.added} 本；書籍變動保留 {report.skipped} 本；需另處理 {report.issues.length} 本。</p>{report.issues.length > 0 && <details><summary>查看保留未分類與處理結果</summary>{report.issues.map((item, index) => <p key={index}>{item.title}：{item.reason}</p>)}</details>}</>}
    {error && <p role="alert">{error}</p>}
  </section>
}
