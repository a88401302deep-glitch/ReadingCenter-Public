import { useRef, useState, type ChangeEvent } from 'react'
import {
  createReadingCenterNotionPreview,
  normalizeReadingCenterNotionPreview,
  selectRepresentativeNotionPreviewRows,
  type NotionCompletionDate,
  type NotionNormalizationRow,
  type NotionReviewCode
} from '../../import'
import { Button } from '../../shared/ui/Button'
import type { ReadingCenterRepositories } from '../../data/repository'
import { NotionReviewQueue } from './NotionReviewQueue'
import './notion-preview.css'

const reviewLabels: Record<NotionReviewCode, string> = {
  missing_title: '書名空白',
  duplicate_candidate: '同名同作者：需比對類型與來源',
  author_url: '作者欄含網址',
  unknown_status: '閱讀狀態待核對',
  missing_status: '閱讀狀態空白',
  serial_status: '連載狀態待核對',
  zero_rating_conflict: '評分與星等不一致',
  invalid_rating: '評分格式待核對',
  invalid_date: '完讀日期格式待核對',
  completed_without_date: '已讀完但無完讀日期',
  completion_date_status_conflict: '原狀態與完讀日期不一致',
  category_delimiter: '分類含多個值，待核對'
}

const statusLabels: Record<string, string> = {
  planned: '尚未開始', reading: '閱讀中', completed: '已讀完',
  abandoned: '棄讀', paused: '暫停'
}

interface PreviewResult {
  id: number
  csvSha256: string
  filename: string
  total: number
  withErrors: number
  withWarnings: number
  needingReview: number
  rows: NotionNormalizationRow[]
  allRows: NotionNormalizationRow[]
}

export function NotionCsvPreview({ onBack, repositories }: { onBack: () => void; repositories: Pick<ReadingCenterRepositories, 'books'> }) {
  const requestId = useRef(0)
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const currentRequest = ++requestId.current
    setResult(null)
    setError(null)
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('請選擇解壓後的「圖書館…_all.csv」檔案。')
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      setError('CSV 超過 20 MB，請確認選擇的是圖書館資料表。')
      return
    }

    setLoading(true)
    try {
      const csv = await file.text()
      if (currentRequest !== requestId.current) return
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csv))
      if (currentRequest !== requestId.current) return
      const csvSha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const preview = createReadingCenterNotionPreview(csv)
      const normalized = normalizeReadingCenterNotionPreview(preview)
      const sampleRows = new Set(selectRepresentativeNotionPreviewRows(preview).map((row) => row.rowNumber))
      setResult({
        id: currentRequest,
        csvSha256,
        filename: file.name,
        total: preview.summary.total,
        withErrors: preview.summary.withErrors,
        withWarnings: preview.summary.withWarnings,
        needingReview: normalized.filter((row) => row.reviewCodes.length > 0 || row.source.diagnostics.length > 0).length,
        rows: normalized.filter((row) => sampleRows.has(row.rowNumber)),
        allRows: normalized
      })
    } catch {
      if (currentRequest === requestId.current) setError('無法讀取 CSV。請確認從 Notion 完整匯出檔選擇「圖書館…_all.csv」。')
    } finally {
      if (currentRequest === requestId.current) setLoading(false)
    }
  }

  return <section aria-label="Notion 匯入預覽" className="notion-preview">
    <div className="notion-preview-heading"><div><h2>Notion 圖書館預覽</h2><p>先從完整 ZIP 解壓，選擇檔名以「圖書館」開頭、以「_all.csv」結尾的檔案。</p></div><Button onClick={onBack} size="small">返回管理</Button></div>
    <label className="notion-preview-picker">選擇圖書館 CSV<input accept=".csv,text/csv" aria-label="選擇圖書館 CSV" onChange={(event) => void selectFile(event)} type="file" /></label>
    <p className="notion-preview-note">CSV 僅在此頁記憶體中預覽；離開後清除。核對選擇可自行下載成檔案。選檔與預覽不會寫入正式資料庫；只有確認匯入、批次搬遷或批次補封面的按鈕會送出寫入。</p>
    {loading && <p role="status">正在整理預覽…</p>}
    {error && <p className="form-message form-message--error" role="alert">{error}</p>}
    {result && <>
      <p className="notion-preview-filename">檔案：{result.filename}</p>
      <div aria-label="預覽統計" className="notion-preview-summary">
        <div><span>資料筆數</span><strong>{result.total}</strong></div>
        <div><span>需核對</span><strong>{result.needingReview}</strong></div>
        <div><span>解析錯誤</span><strong>{result.withErrors}</strong></div>
        <div><span>解析提醒</span><strong>{result.withWarnings}</strong></div>
      </div>
      <p className="notion-preview-note">以下顯示 {result.rows.length} 筆代表資料；同一筆可有多項提醒，統計數字不可相加。原狀態與建議不同時仍須逐筆確認。</p>
      <div className="notion-preview-rows">{result.rows.map((row) => <article className="notion-preview-row" key={row.rowNumber}>
        <div className="notion-preview-row-title"><span>CSV 第 {row.rowNumber} 行</span><h3>{row.proposed.title || '未填書名'}</h3></div>
        <dl>
          <div><dt>作者</dt><dd>{row.proposed.creator ?? (row.source.values.creator ? '待核對' : '未填')}</dd></div>
          <div><dt>分類原值</dt><dd>{row.source.values.categories || '未填'}</dd></div>
          <div><dt>原狀態 → 建議</dt><dd>{row.source.values.status || '未填'} → {row.proposed.status ? statusLabels[row.proposed.status] : '待核對'}</dd></div>
          <div><dt>評分</dt><dd>{row.reviewCodes.includes('invalid_rating') ? '待核對' : row.proposed.rating === null ? '未評分' : `${row.proposed.rating} 分`}</dd></div>
          <div><dt>日期</dt><dd>{formatCompletionDate(row.proposed.completionDate, String(row.source.values.readDates || ''))}</dd></div>
        </dl>
        {row.reviewCodes.length > 0 && <p className="notion-preview-reasons">需核對：{row.reviewCodes.map((code) => reviewLabels[code]).join('、')}</p>}
        {row.source.diagnostics.some((item) => item.severity === 'error') && <p className="notion-preview-reasons">來源列有解析錯誤</p>}
      </article>)}</div>
      <NotionReviewQueue csvSha256={result.csvSha256} key={result.id} repositories={repositories} rows={result.allRows} />
    </>}
  </section>
}

function formatCompletionDate(value: NotionCompletionDate | null, original: string): string {
  if (!value) return original ? '待核對' : '未填'
  if (value.precision === 'range') return `${value.startedOn} 開始 → ${value.completedOn} 完讀`
  if (value.precision === 'minute') return `${value.completedOn} ${value.localTime}（GMT+8）`
  return value.completedOn
}
