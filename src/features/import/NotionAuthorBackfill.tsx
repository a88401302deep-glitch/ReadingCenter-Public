import { useEffect, useRef, useState } from 'react'
import { prepareNotionAuthorBackfill, runNotionAuthorBackfill, type AuthorBackfillPlan, type AuthorBackfillReport } from '../../import/notion-author-backfill'
import { CloudflareEntityClient } from '../../sync/cloudflare/entity-client'
import { CREATOR_ROLE_LABELS } from '../../domain'
import { Button } from '../../shared/ui/Button'

export function NotionAuthorBackfill({ onUpdated }: { onUpdated: () => void }) {
  const [plan, setPlan] = useState<AuthorBackfillPlan | null>(null)
  const [report, setReport] = useState<AuthorBackfillReport | null>(null)
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
        const result = await runNotionAuthorBackfill(plan, client, active.signal, (value) => { if (!active.signal.aborted) setReport(value) })
        if (!active.signal.aborted) { setReport(result); onUpdated() }
      } else {
        setPlan(null); setReport(null)
        const preview = prepareNotionAuthorBackfill(await client.list('book'))
        if (!active.signal.aborted) setPlan(preview)
      }
    } catch { if (!active.signal.aborted) setError('無法完成作者處理，請確認登入與網路後重新比對。已寫入的作者會保留。') }
    finally { controller.current = null; setBusy(false) }
  }
  const issues = report?.issues ?? plan?.unresolved ?? []
  const missing = issues.filter((item) => item.reason === '來源未提供可確認的作者姓名').length
  const urls = issues.filter((item) => item.reason === '作者網址需要來源查證').length
  const roles = issues.filter((item) => item.reason === '角色、別名或原文結構需要另行判斷').length
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report ?? plan, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a'); link.href = url; link.download = 'notion-author-result.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section aria-label="Notion 批次補作者">
    <h3>Notion 批次補作者</h3>
    <p>直接讀取正式書庫保留的作者原文，不需要重新選 CSV。姓名、已查證網址及明確角色一次補入；原作、漫畫、繪圖、監修等角色分開保留；已有作者或修改過的書籍保留。尚未查證的網址、角色與可能的別名另列報告。原始作者空白的書籍會分開統計。</p>
    <Button disabled={busy} onClick={() => void execute(false)}>比對缺少的作者</Button>
    {plan && <><p role="status">可批次補 {plan.candidates.length} 本；保留 {plan.preserved} 本；需另處理 {plan.unresolved.length} 本。尚未寫入。</p><details><summary>查看本批作者</summary>{plan.candidates.map((item) => <p key={item.book.id}>{item.book.title}：{item.credits ? item.credits.map((credit) => `${CREATOR_ROLE_LABELS[credit.role]}：${credit.name}`).join('；') : item.names.map((name) => `${name}${item.aliases?.[name]?.length ? `（亦名：${item.aliases[name].join('、')}）` : ''}`).join('、')}</p>)}</details><Button disabled={busy || !plan.candidates.length} onClick={() => void execute(true)}>確認批次補作者</Button></>}
    {busy && <><p role="status">正在處理作者資料…</p><Button onClick={() => controller.current?.abort()}>停止</Button></>}
    {report && <p role="status">{report.stopped ? '已停止，可重新比對接續' : busy ? '處理中' : '本批結束'}：已補 {report.added} 本；書籍變動保留 {report.skipped} 本；需另處理 {report.issues.length} 本。</p>}
    {(plan || report) && <p>剩餘原因：來源作者空白 {missing} 本；網址待查證 {urls} 本；角色或別名待整理 {roles} 本；其他 {issues.length - missing - urls - roles} 本。</p>}
    {(plan || report) && <Button onClick={download}>下載作者結果</Button>}
    {error && <p role="alert">{error}</p>}
  </section>
}
