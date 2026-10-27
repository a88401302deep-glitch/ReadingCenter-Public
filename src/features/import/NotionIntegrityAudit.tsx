import { useEffect, useRef, useState } from 'react'
import { AUDIT_FIELDS, AUDIT_RESULTS, createNotionAuditSnapshot, auditNotionIntegrity, type NotionIntegrityAudit as AuditReport } from '../../import/notion-integrity-audit'
import { CloudflareEntityClient } from '../../sync/cloudflare/entity-client'
import { Button } from '../../shared/ui/Button'

export function NotionIntegrityAudit() {
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [report, setReport] = useState<AuditReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const check = async () => {
    if (controller.current) return
    const active = new AbortController(); controller.current = active
    setBusy(true); setError(null); setReport(null)
    const client = new CloudflareEntityClient('', fetch, active.signal)
    try {
      if (csvFile && (!csvFile.name.toLowerCase().endsWith('.csv') || csvFile.size > 20 * 1024 * 1024)) throw new Error('請選擇原始 CSV，檔案須小於 20 MB。')
      const snapshot = csvFile ? await createNotionAuditSnapshot(await csvFile.text()) : undefined
      if (active.signal.aborted) return
      const [books, dictionaries, contents, cycles] = await Promise.all(['book', 'dictionary', 'readingContent', 'readingCycle'].map(kind => client.list(kind as 'book' | 'dictionary' | 'readingContent' | 'readingCycle', true)))
      if (!active.signal.aborted) setReport(auditNotionIntegrity(books, dictionaries, contents, cycles, snapshot))
    } catch (cause) { if (!active.signal.aborted) setError(`核對未完成。${cause instanceof Error ? cause.message : '請確認登入與網路後重試。'}未寫入任何資料。`) }
    finally { controller.current = null; setBusy(false) }
  }
  const priorityDetails = report?.details.filter(item => item.result === '正式欄位缺少' || item.field === '來源資料') ?? []
  const reasonGroups = new Map<string, NonNullable<AuditReport['details']>>()
  for (const item of report?.details ?? []) {
    if (item.result === '正式欄位缺少' || item.field === '來源資料') continue
    const key = `${item.field}：${item.result}；${item.reason || '原因尚未確認'}`
    reasonGroups.set(key, [...(reasonGroups.get(key) ?? []), item])
  }
  return <section aria-label="Notion 資料完整性核對">
    <h3>Notion 資料完整性核對</h3>
    <p>直接比對正式欄位與每本書保留的匯入來源，不需要重選 CSV。唯讀核對，不修改資料；內容不同可能是後來的修改，不能直接視為遺失。</p>
    <label>原始搬遷 CSV（選填）<input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => { setCsvFile(event.target.files?.[0] ?? null); setReport(null); setError(null) }} /></label>
    <p>選擇同一份原始 CSV，可核對早期試匯入書籍，並檢查原始列的搬入範圍。檔案只在此頁面讀取，不上傳，也不重新匯入。</p>
    <Button disabled={busy} onClick={() => void check()}>核對 Notion 正式欄位</Button>
    {busy && <p role="status">正在讀取正式資料…</p>}
    {error && <p role="alert">{error}</p>}
    {report && <>
      <p role="status">正式 Notion 書籍 {report.books} 本；可核對 {report.checked} 本；來源格式需另判定 {report.uncheckable} 本；已刪除 Notion 書籍 {report.deletedBooks} 本。</p>
      {report.coverage && <p>原始 CSV 共 {report.coverage.total} 列；正式書籍已有來源對應 {report.coverage.present} 列；僅已刪除書籍對應 {report.coverage.deleted} 列；未找到來源對應 {report.coverage.missing} 列。來源對應不等於所有欄位相符，欄位結果列於下方。</p>}
      <section aria-label="優先釐清項目">
        <h4>優先釐清項目（{priorityDetails.length}）</h4>
        <p>以下直接列出正式欄位缺少與來源格式無法核對的書籍。缺少表示本次未找到預期資料，尚不能判定為遺失。</p>
        {priorityDetails.length === 0 ? <p>目前沒有正式欄位缺少或來源格式例外。</p> : priorityDetails.map((item, index) => <p key={index}>{item.title}｜{item.field}：{item.result}；{item.reason || '未找到預期的正式欄位或閱讀週期，原因尚未確認'}</p>)}
      </section>
      <p>{report.coverage ? '本次使用已選擇的原始 CSV，以搬遷來源識別比對，不依書名猜測配對。' : '此核對以目前正式書籍保留的來源為範圍，不能證明未保留在書庫中的原始列都有搬入。'}資料讀取期間若有其他裝置修改，請同步完成後重跑。</p>
      <p>「原始空白」包含未評分、零天及明確尚未開始而無須建立閱讀週期。相符只表示本次欄位與保留來源一致。</p>
      {AUDIT_FIELDS.map(field => <details key={field}><summary>{field}：相符 {report.fields[field]['相符']}；缺少 {report.fields[field]['正式欄位缺少']}；不同 {report.fields[field]['內容不同']}</summary><p>{AUDIT_RESULTS.map(result => `${result} ${report.fields[field][result]}`).join('；')}</p></details>)}
      <p>來源長篇心得標記 {report.longReviewFlags} 本，相關筆記連結 {report.relatedNoteLinks} 本。這些是來源標記與連結，不能證明長文正文已匯入。封面另行處理。</p>
      <h4>其他項目依共同原因分組</h4>
      <p>以下數量是欄位項目數，同一本書可能出現多次；不需要逐項批准。</p>
      {[...reasonGroups].map(([reason, items]) => <details key={reason}><summary>{reason}（{items.length} 項）</summary>{items.map((item, index) => <p key={index}>{item.title}</p>)}</details>)}
    </>}
  </section>
}
