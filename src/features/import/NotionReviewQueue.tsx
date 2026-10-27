import { NotionBulkMigration } from './NotionBulkMigration'
import { NotionCoverBackfill } from './NotionCoverBackfill'
import { useRef, useState, type ChangeEvent } from 'react'
import type { NotionNormalizationRow } from '../../import'
import { parseNotionReviewFile, resolveNotionReviewRows, serializeNotionReviewFile, type NotionReviewDecisions } from '../../import/notion-review-file'
import { buildNotionImportPlan } from '../../import/notion-import-plan'
import { stageNotionImport } from '../../import/notion-staging'
import { checkNotionWorkCollisionsInRemote, checkNotionWorkCollisionsInRepository } from '../../import/notion-reimport-check'
import { CloudflareEntityClient } from '../../sync/cloudflare/entity-client'
import { useAuth } from '../auth/auth-context'
import { parseReviewedNotionPlan } from '../../import/notion-reviewed-plan'
import { buildNotionPilotBatch } from '../../import/notion-pilot-batch'
import { openNotionZip } from '../../import/notion-zip-reader'
import type { BookCover } from '../../domain'
import type { ReadingCenterRepositories } from '../../data/repository'
import { Button } from '../../shared/ui/Button'

export function NotionReviewQueue({ rows, csvSha256, repositories }: { rows: NotionNormalizationRow[]; csvSha256: string; repositories: Pick<ReadingCenterRepositories, 'books'> }) {
  const { authEnabled, localAccess } = useAuth()
  const reviewRows = rows.filter((row) => row.reviewCodes.includes('completion_date_status_conflict') || row.reviewCodes.includes('duplicate_candidate'))
  const [decisions, setDecisions] = useState<NotionReviewDecisions>({})
  const [fileError, setFileError] = useState<string | null>(null)
  const [shown, setShown] = useState(10)
  const [pendingOnly, setPendingOnly] = useState(false)
  const [collisionPreview, setCollisionPreview] = useState<Awaited<ReturnType<typeof checkNotionWorkCollisionsInRepository>> | null>(null)
  const [collisionError, setCollisionError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [reviewedPlan, setReviewedPlan] = useState<ReturnType<typeof buildNotionImportPlan> | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [previewUsesPairings, setPreviewUsesPairings] = useState(false)
  const [comparisonTarget, setComparisonTarget] = useState<'local' | 'remote'>('local')
  const [pilotRow, setPilotRow] = useState('')
  const [pilotMediaType, setPilotMediaType] = useState('ebook')
  const [pilotPending, setPilotPending] = useState(false)
  const [pilotError, setPilotError] = useState<string | null>(null)
  const [pilotResult, setPilotResult] = useState<string | null>(null)
  const [coverZip, setCoverZip] = useState<Awaited<ReturnType<typeof openNotionZip>> | null>(null)
  const coverZipRequest = useRef(0)
  const [coverZipLoading, setCoverZipLoading] = useState(false)
  const [coverZipName, setCoverZipName] = useState('')
  const [coverZipError, setCoverZipError] = useState<string | null>(null)
  const resolved = resolveNotionReviewRows(rows, decisions)
  const otherReminders = resolved.filter((row) => row.pendingReviewCodes.some((code) => code !== 'completion_date_status_conflict' && code !== 'duplicate_candidate')).length
  const pendingPairs = resolved.filter((row) => row.duplicate === 'same-work').length
  const readEvidenceRows = rows.filter((row) => row.readingEvidence.hasRead).length
  const uncorroboratedCompleted = rows.filter((row) => row.source.values.status === '已讀完' && !row.readingEvidence.hasRead).length
  const pending = reviewRows.filter((row) =>
    (row.reviewCodes.includes('completion_date_status_conflict') && !decisions[row.rowNumber]?.date) ||
    (row.reviewCodes.includes('duplicate_candidate') && !decisions[row.rowNumber]?.duplicate)
  ).length
  const visible = (pendingOnly ? reviewRows.filter((row) =>
    (row.reviewCodes.includes('completion_date_status_conflict') && !decisions[row.rowNumber]?.date) ||
    (row.reviewCodes.includes('duplicate_candidate') && !decisions[row.rowNumber]?.duplicate)
  ) : reviewRows).slice(0, shown)

  const decide = (rowNumber: number, kind: keyof NotionReviewDecisions[number], value: string) => {
    setCollisionPreview(null)
    setReviewedPlan(null)
    setPlanError(null)
    setDecisions((current) => ({
      ...current,
      [rowNumber]: { ...current[rowNumber], [kind]: value || undefined }
    }))
  }

  const checkExistingBooks = async (target: 'local' | 'remote') => {
    setChecking(true)
    setCollisionPreview(null)
    setCollisionError(null)
    try {
      const plan = reviewedPlan ?? buildNotionImportPlan(csvSha256, rows, decisions)
      const staging = stageNotionImport(plan)
      const result = target === 'remote'
        ? await checkNotionWorkCollisionsInRemote(plan, staging, new CloudflareEntityClient())
        : await checkNotionWorkCollisionsInRepository(plan, staging, repositories)
      setCollisionPreview(result)
      setComparisonTarget(target)
      setPreviewUsesPairings(reviewedPlan !== null)
    } catch {
      setCollisionError(target === 'remote' ? '無法讀取正式書庫。尚未完成正式比對；請確認資料 API 已啟用，且已登入。' : '無法讀取本機書庫或完成比對。')
    } finally { setChecking(false) }
  }

  const pilotGroup = reviewedPlan && collisionPreview && comparisonTarget === 'remote'
    ? stageNotionImport(reviewedPlan).workGroups.find((group) => group.sourceRowNumbers.length === 1 && group.sourceRowNumbers[0] === Number(pilotRow))
    : undefined
  const pilotCollision = pilotGroup && collisionPreview?.groups.find((group) => group.stagingKey === pilotGroup.stagingKey)

  const loadCoverZip = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const request = ++coverZipRequest.current
    setCoverZip(null)
    setCoverZipError(null)
    setCoverZipName(file.name)
    setCoverZipLoading(true)
    try {
      const zip = await openNotionZip(file)
      if (request === coverZipRequest.current) setCoverZip(zip)
    } catch (cause) {
      if (request === coverZipRequest.current) setCoverZipError(cause instanceof Error ? cause.message : '無法讀取封面 ZIP')
    } finally {
      if (request === coverZipRequest.current) setCoverZipLoading(false)
    }
  }
  const coverZipStatus = coverZipLoading ? `正在讀取封面 ZIP：${coverZipName}`
    : coverZip ? `已載入封面 ZIP：${coverZipName}（${coverZip.filenames.length} 個檔案）。可以比對補封面。` : null

  const importOneBook = async () => {
    if (!authEnabled) return
    setPilotPending(true)
    setPilotError(null)
    setPilotResult(null)
    try {
      if (!reviewedPlan || !pilotGroup || pilotCollision?.kind !== 'new') throw new Error('請先比對正式書庫，並選擇未連結、無同名衝突的單筆作品')
      const staging = stageNotionImport(reviewedPlan)
      const fresh = await checkNotionWorkCollisionsInRemote(reviewedPlan, staging, new CloudflareEntityClient())
      if (fresh.groups.find((group) => group.stagingKey === pilotGroup.stagingKey)?.kind !== 'new') throw new Error('正式書庫已變動，請重新比對後再試')
      let cover: BookCover | undefined
      if (pilotGroup.coverReferences.length) {
        const reference = pilotGroup.coverReferences[0]
        if (pilotGroup.coverReferences.length !== 1 || reference.kind !== 'local-export-file' || !coverZip) throw new Error('請載入封面 ZIP，並先處理多張或外部封面的選擇')
        const bytes = await coverZip.readImage(reference.value)
        const mimeType = /\.png$/i.test(reference.value) ? 'image/png' : /\.webp$/i.test(reference.value) ? 'image/webp' : /\.avif$/i.test(reference.value) ? 'image/avif' : 'image/jpeg'
        const uploaded = await fetch('/api/v1/covers/notion', { method: 'POST', credentials: 'include', headers: {
          'Content-Type': mimeType, 'X-Book-Id': `notion:book:${pilotGroup.stagingKey}`, 'X-Book-Title': encodeURIComponent(pilotGroup.title)
        }, body: new Blob([Uint8Array.from(bytes)], { type: mimeType }) })
        const uploadBody: unknown = await uploaded.json()
        if (!uploaded.ok || !isCoverUpload(uploadBody)) throw new Error(isPilotResponse(uploadBody) ? uploadBody.error?.message ?? '封面未能儲存' : '封面儲存回應無效')
        cover = uploadBody.data.cover
      }
      const items = buildNotionPilotBatch(reviewedPlan, staging, [pilotGroup.sourceRowNumbers[0]], pilotMediaType, new Date().toISOString(), cover)
      const response = await fetch('/api/v1/import/notion/pilot', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ csvSha256, items })
      })
      const result: unknown = await response.json()
      if (!response.ok) throw new Error(isPilotResponse(result) ? result.error?.message ?? '正式匯入未成功' : '正式匯入未成功')
      if (!isPilotResponse(result) || !result.data) throw new Error('正式匯入回應格式不正確，請先重新比對，勿重複寫入')
      setPilotResult(result.data.status === 'already-applied' ? '此書已匯入，未重複新增' : `已寫入 1 本書及 ${result.data.inserted - 1} 筆相關資料`)
      await checkExistingBooks('remote')
    } catch (cause) { setPilotError(cause instanceof Error ? cause.message : '正式匯入未成功') }
    finally { setPilotPending(false) }
  }

  const download = () => {
    const blob = new Blob([serializeNotionReviewFile(csvSha256, rows, decisions)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `readingcenter-notion-review-${csvSha256.slice(0, 12)}.json`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const downloadPlan = () => {
    const plan = reviewedPlan ?? buildNotionImportPlan(csvSha256, rows, decisions)
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `readingcenter-notion-plan-${csvSha256.slice(0, 12)}.json`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const loadFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 1024 * 1024) { setFileError('核對檔超過 1 MB，請確認選對檔案'); return }
    try {
      const restored = parseNotionReviewFile(await file.text(), csvSha256, rows)
      setDecisions(restored)
      setCollisionPreview(null)
      setReviewedPlan(null)
      setPlanError(null)
      setFileError(null)
    } catch (cause) { setFileError(cause instanceof Error ? cause.message : '無法載入核對檔') }
  }

  const loadReviewedPlan = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setPlanError('配對計畫超過 10 MB'); return }
    try {
      const parsed = parseReviewedNotionPlan(await file.text(), csvSha256, rows, decisions)
      setFileError(null)
      setReviewedPlan(parsed)
      setCollisionPreview(null)
      setPlanError(null)
    } catch (cause) { setPlanError(cause instanceof Error ? cause.message : '無法載入配對計畫') }
  }

  const bulkPlan = reviewedPlan ?? buildNotionImportPlan(csvSha256, rows, decisions)

  return <section aria-label="匯入前逐筆核對" className="notion-review">
    <div className="notion-review-heading">
      <div><h3>來源資料核對（可選）</h3><p>已完成的核對可載入沿用；未核對資料可批次搬遷並保留來源，不會自動合併同名作品。</p></div>
      <label><input checked={pendingOnly} onChange={(event) => { setPendingOnly(event.target.checked); setShown(10) }} type="checkbox" />只看未核對</label>
    </div>
    <p role="status">本次發現 {reviewRows.length} 筆需判斷的資料，尚有 {pending} 筆未完成這兩類核對；標記同一作品待配對 {pendingPairs} 筆，其他提醒涉及 {otherReminders} 筆。{pilotResult ?? '預覽及核對不會寫入。'}</p>
    <p className="notion-preview-note">有「時間」或「關聯生活點滴」的已讀證據：{readEvidenceRows} 筆來源列。原狀態為已讀完但兩者皆無：{uncorroboratedCompleted} 筆，暫不納入已讀或完讀統計。建頁時間不計入閱讀日期；來源列尚未去重。</p>
    <p className="notion-preview-note">離開前請下載核對檔；下次先選同一份 CSV，再載入核對檔即可接續。核對選擇不會自動同步至 OneDrive，也不會自行匯入或合併作品。</p>
    <p className="notion-preview-note">唯讀匯入計畫保留每列來源與封面引用；{reviewedPlan ? '已載入的配對計畫會用於下載及書庫比對。' : '尚未載入另行確認的配對計畫時，下載版本仍按來源列計算。'}</p>
    <div className="notion-review-actions"><Button onClick={download} size="small">下載核對檔</Button><Button disabled={pending > 0} onClick={downloadPlan} size="small">下載唯讀匯入計畫</Button><Button disabled={pending > 0 || checking} onClick={() => void checkExistingBooks('local')} size="small">比對本機書庫</Button>{authEnabled && <Button disabled={pending > 0 || checking || !reviewedPlan} onClick={() => void checkExistingBooks('remote')} size="small">比對正式書庫</Button>}<label>載入核對檔<input accept=".json,application/json" aria-label="載入核對檔" onChange={(event) => void loadFile(event)} type="file" /></label><label>載入已確認配對計畫<input accept=".json,application/json" aria-label="載入已確認配對計畫" disabled={pending > 0} onChange={(event) => void loadReviewedPlan(event)} type="file" /></label></div>
    {fileError && <p className="form-message form-message--error" role="alert">{fileError}</p>}
    {planError && <p className="form-message form-message--error" role="alert">{planError}</p>}
    {reviewedPlan && <p className="notion-preview-note" role="status">已載入配對計畫：確認同次閱讀 {reviewedPlan.pairingResolutions.filter((item) => item.kind === 'same-reading').length} 組、作品分組待核對 {reviewedPlan.workGroupingProposals.length} 組。可重新比對現有書庫。</p>}
    {collisionError && <p className="form-message form-message--error" role="alert">{collisionError}</p>}
    {checking && <p role="status">正在比對現有書庫…</p>}
    {collisionPreview && <section aria-label="現有書庫唯讀比對" className="notion-review">
      <p role="status">本次比對{comparisonTarget === 'remote' ? '正式書庫' : '目前裝置的本機書庫'} {collisionPreview.summary.existingBooksCompared} 本：已連結 {collisionPreview.summary.linkedGroups} 組；{comparisonTarget === 'remote' ? '正式書庫未找到' : '本機未找到'} {collisionPreview.summary.newGroups} 組；待辨認 {collisionPreview.summary.reviewGroups} 組；衝突 {collisionPreview.summary.conflictingGroups} 組；無書名 {collisionPreview.summary.blockedGroups} 組。</p>
      <p className="notion-preview-note">{comparisonTarget === 'remote' ? '已從已登入的遠端資料 API 讀取；此為唯讀結果，不代表匯入已可寫入。' : '本機未找到不代表正式書庫沒有此書，不能依這份結果判定可匯入。'}{previewUsesPairings ? '本次已使用載入的配對計畫。' : '此頁尚未納入另行確認的來源配對。'}同名只列待辨認候選，不會自動合併。</p>
      {collisionPreview.groups.filter((group) => group.kind === 'conflict' || group.kind === 'review').slice(0, 20).map((group) => <p className="notion-review-detail" key={group.stagingKey}>CSV 第 {group.sourceRowNumbers.join('、')} 行：{group.kind === 'conflict' ? '來源連到不同書籍' : '待辨認'}{group.possibleBookIds.length ? `（同名書籍候選 ${group.possibleBookIds.length} 筆）` : ''}</p>)}
      {collisionPreview.summary.conflictingGroups + collisionPreview.summary.reviewGroups > 20 && <p className="notion-preview-note">此處先顯示前 20 組待處理項目。</p>}
    </section>}
    {reviewedPlan && comparisonTarget === 'remote' && collisionPreview && <section aria-label="單本正式匯入" className="notion-review">
      <h4>單本正式匯入試驗</h4>
      <p className="notion-preview-note">目前接受無封面或 ZIP 中有單張封面的作品；多張與外部封面仍需先核對。另須無未解決欄位、無外部網址且正式書庫未找到。請確認書籍類型；寫入前會重新比對。</p>
      <label className="notion-review-choice">Notion 完整封面 ZIP（有封面的作品才需選擇）<input accept=".zip,application/zip" aria-label="選擇 Notion 封面 ZIP" onChange={(event) => void loadCoverZip(event)} type="file" /></label>
      {coverZip && <p className="notion-preview-note">已讀取 ZIP 目錄：{coverZip.filenames.length} 個檔案。圖片僅在確認匯入該書時逐張讀取。</p>}
      {coverZipStatus && <p role="status" aria-label="封面 ZIP 狀態">{coverZipStatus}</p>}{coverZipError && <p className="form-message form-message--error" role="alert">{coverZipError}</p>}
      <label className="notion-review-choice">CSV 行號<input min="2" onChange={(event) => { setPilotRow(event.target.value); setPilotError(null); setPilotResult(null) }} type="number" value={pilotRow} /></label>
      <label className="notion-review-choice">書籍類型<select onChange={(event) => setPilotMediaType(event.target.value)} value={pilotMediaType}><option value="ebook">電子書</option><option value="manga">漫畫</option><option value="print">紙本書</option></select></label>
      {pilotGroup && <p className="notion-review-detail">{pilotGroup.title} · 出版社：{pilotGroup.publisherDisplayProposal ?? pilotGroup.publisherProposal ?? '未填'} · 分類：{pilotGroup.sourceMetadata[0]?.categoryText || '未填'} · 標籤：{pilotGroup.sourceMetadata[0]?.tagText || '未填'} · 比對結果：{pilotCollision?.kind === 'new' ? '正式書庫未找到' : '不可寫入'}</p>}
      <Button disabled={!authEnabled || pilotPending || checking || pilotCollision?.kind !== 'new' || Boolean(pilotGroup?.coverReferences.length && !coverZip)} onClick={() => void importOneBook()} size="small">確認寫入這一本</Button>
      {pilotPending && <p role="status">正在重新比對並寫入…</p>}
      {pilotError && <p className="form-message form-message--error" role="alert">{pilotError}</p>}
      {pilotResult && <p role="status">{pilotResult}</p>}
    </section>}
    {(localAccess ?? authEnabled) && <section className="notion-review"><label>Notion 搬遷封面 ZIP<input accept=".zip,application/zip" aria-label="選擇批次封面 ZIP" onChange={(event) => void loadCoverZip(event)} type="file" /></label>{coverZipStatus && <p role="status" aria-label="封面 ZIP 狀態">{coverZipStatus}</p>}{coverZipError && <p role="alert">{coverZipError}</p>}<NotionCoverBackfill key={JSON.stringify(["covers", csvSha256, decisions, reviewedPlan?.pairingResolutions])} plan={bulkPlan} zip={coverZip} remoteEnabled={authEnabled} /><NotionBulkMigration key={JSON.stringify(["migration", csvSha256, decisions, reviewedPlan?.pairingResolutions])} plan={bulkPlan} zip={coverZip} remoteEnabled={authEnabled} /></section>}
    <div className="notion-preview-rows">{visible.map((row) => <article className="notion-preview-row" key={row.rowNumber}>
      <div className="notion-preview-row-title"><span>CSV 第 {row.rowNumber} 行</span><h4>{row.proposed.title || '未填書名'}</h4></div>
      <p className="notion-review-detail">作者：{row.source.values.creator || '未填'} · 分類：{row.source.values.categories || '未填'} · 來源：{row.source.raw['來源'] || '未提供'}</p>
      {row.reviewCodes.includes('completion_date_status_conflict') && <label className="notion-review-choice">原狀態「{row.source.values.status || '未填'}」，完讀日期「{row.source.values.readDates}」
        <select aria-label={`第 ${row.rowNumber} 行狀態核對`} onChange={(event) => decide(row.rowNumber, 'date', event.target.value)} value={decisions[row.rowNumber]?.date ?? ''}>
          <option value="">待核對</option><option value="use-completion-date">依完讀日期標記已讀完</option><option value="keep-source">保留原狀態，日期待後續處理</option>
        </select>
      </label>}
      {row.reviewCodes.includes('duplicate_candidate') && <label className="notion-review-choice">同名同作者候選（請比較分類與來源）
        <select aria-label={`第 ${row.rowNumber} 行重複核對`} onChange={(event) => decide(row.rowNumber, 'duplicate', event.target.value)} value={decisions[row.rowNumber]?.duplicate ?? ''}>
          <option value="">待核對</option><option value="separate">不同作品，分開保留</option><option value="same-work">可能同一作品，待後續配對</option>
        </select>
      </label>}
    </article>)}</div>
    {shown < (pendingOnly ? pending : reviewRows.length) && <Button onClick={() => setShown((count) => count + 10)} size="small">顯示更多</Button>}
  </section>
}

function isPilotResponse(value: unknown): value is { data?: { status: 'inserted' | 'already-applied'; inserted: number }; error?: { message: string } } {
  return value !== null && typeof value === 'object' && ('data' in value || 'error' in value)
}

function isCoverUpload(value: unknown): value is { data: { cover: BookCover } } {
  if (!value || typeof value !== 'object' || !('data' in value) || !value.data || typeof value.data !== 'object' || !('cover' in value.data)) return false
  const cover = value.data.cover
  return Boolean(cover && typeof cover === 'object' && 'path' in cover && typeof cover.path === 'string' && 'mimeType' in cover && typeof cover.mimeType === 'string')
}
