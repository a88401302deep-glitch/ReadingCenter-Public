import { useEffect, useRef, useState } from 'react'
import type { buildNotionImportPlan } from '../../import/notion-import-plan'
import { stageNotionBulkImport } from '../../import/notion-bulk-batch'
import { runNotionBulkImport, type NotionMigrationReport } from '../../import/notion-bulk-runner'
import type { openNotionZip } from '../../import/notion-zip-reader'
import { checkNotionWorkCollisionsInRemote } from '../../import/notion-reimport-check'
import { CloudflareEntityClient } from '../../sync/cloudflare/entity-client'
import { Button } from '../../shared/ui/Button'

type Plan = ReturnType<typeof buildNotionImportPlan>
export function NotionBulkMigration({ plan, zip, remoteEnabled }: { remoteEnabled: boolean; plan: Plan; zip: Awaited<ReturnType<typeof openNotionZip>> | null }) {
  const [report, setReport] = useState<NotionMigrationReport | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const staging = stageNotionBulkImport(plan)
  const start = async () => {
    if (!remoteEnabled || !confirmed || controller.current) return
    const active = new AbortController()
    controller.current = active
    setRunning(true)
    setError(null)
    setReport(null)
    try {
      const existing = await checkNotionWorkCollisionsInRemote(plan, staging, new CloudflareEntityClient())
      const existingWorkKeys = new Set(existing.groups.filter((group) => group.sourceRowNumbers.length === 1 && group.linkedBookIds.length === 1).map((group) => group.stagingKey))
      setReport(await runNotionBulkImport(plan, zip, { existingWorkKeys, signal: active.signal, onProgress: setReport }))
    } catch (cause) { setError(cause instanceof Error ? cause.message : '正式資料比對失敗，未開始搬遷') }
    finally { controller.current = null; setRunning(false) }
  }
  const downloadReport = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = `notion-migration-result-${plan.csvSha256.slice(0, 12)}.json`
    document.body.append(link); link.click(); link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section aria-label="Notion 一次性批次搬遷">
    <h3>Notion 一次性批次搬遷</h3>
    <p>共 {staging.workGroups.length} 組來源資料。沿用已載入的核對；同名與未確認配對分開保留，不必逐筆確認。已匯入的來源跳過，不覆蓋人工修改。</p>
    <p>無法確定的狀態、作者等原始欄位保留在「匯入來源資料」。書籍媒介標為未分類；缺少日期不補造日期。CSV 的長篇心得旗標不等於正文，正文尚未搬入。</p>
    <p>{zip ? '已載入封面 ZIP；可唯一對應的本機圖片將自動搬入。' : '尚未載入封面 ZIP；可在上方選擇。未搬入的封面引用會保留並列入報告。'}</p>
    <label><input type="checkbox" checked={confirmed} disabled={running} onChange={(event) => setConfirmed(event.target.checked)} />確認將這批歷史資料搬入正式書庫，歧義資料分開保留</label>
    <div className="notion-review-actions"><Button disabled={!remoteEnabled || !confirmed || running} onClick={() => void start()}>確認批次搬遷</Button>{running && <Button onClick={() => controller.current?.abort()}>停止搬遷</Button>}{report && <Button onClick={downloadReport}>下載搬遷結果</Button>}</div>
    {error && <p role="alert">{error}</p>}
    {report && <p role="status">{running ? '搬遷中' : report.stopped ? '已停止，可用相同 CSV 接續' : '本次搬遷結束'}：新增 {report.inserted} 組，已存在 {report.existing} 組，未搬入 {report.issues.length} 組，封面提醒 {report.coverWarnings.length} 組。共 {report.total} 組。</p>}
    {report && report.issues.length > 0 && <p>未搬入資料仍在來源檔與結果報告；不需要逐筆批准，先解決共同原因再接續。</p>}
  </section>
}
