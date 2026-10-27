import { useRef, useState } from 'react'
import type { ReadingCenterRepositories } from '../../data'
import { useAuth } from '../auth/auth-context'
import { Button } from '../../shared/ui'
import { readSpreadsheet, importSpreadsheet, type SheetPreview } from './spreadsheet-books'
export function SpreadsheetImport({ repositories, onChanged, onBack }: { repositories: ReadingCenterRepositories; onChanged: () => void; onBack: () => void }) {
 const { previewReadOnly } = useAuth()
 const [preview, setPreview] = useState<SheetPreview | null>(null), [error, setError] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
 const request = useRef(0)
 const select = async (file?: File) => {
  const id = ++request.current; setPreview(null); setMessage(''); setError(''); if (!file) return
  setBusy(true)
  try { const value = await readSpreadsheet(file); if (id === request.current) setPreview(value) } catch (reason) { if (id === request.current) setError(reason instanceof Error ? reason.message : '無法讀取表格') } finally { if (id === request.current) setBusy(false) }
 }
 const save = async () => {
  if (!preview || busy || previewReadOnly) return
  setBusy(true); setError('')
  try { const result = await importSpreadsheet(repositories, preview); setMessage(`已新增 ${result.added} 本，略過 ${result.skipped} 本同名書籍。`); setPreview(null); onChanged() } catch (reason) { setError(reason instanceof Error ? reason.message : '無法匯入') } finally { setBusy(false) }
 }
 return <section className="sheet-import" aria-label="Excel 書籍匯入"><div className="section-heading"><h2>Excel 書籍清單</h2><Button disabled={busy} onClick={onBack}>返回新增方式</Button></div><p>第一列使用「書名」，其餘可填作者、出版社、ISBN、類型、閱讀狀態、完讀日期、封面網址、分類、標籤、來源、短評與備註。沒有日期可留白。</p><label>選擇 Excel 或 CSV<input type="file" accept=".xlsx,.csv" disabled={busy} onChange={event => void select(event.target.files?.[0])} /></label>{busy && <p role="status">正在整理書籍…</p>}{error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}{preview && <><p>{preview.rows.length} 本待匯入；同名書籍會略過，不覆寫現有資料。</p>{preview.extraColumns.length > 0 && <p role="alert">以下欄位不會匯入：{preview.extraColumns.join('、')}。</p>}<div className="sheet-preview-scroll"><table><thead><tr><th>書名</th><th>作者</th><th>出版社</th></tr></thead><tbody>{preview.rows.map(row => <tr key={row.row}><td>{row.draft.title}</td><td>{row.draft.authorNames?.join('、')}</td><td>{row.draft.publisherName}</td></tr>)}</tbody></table></div><Button disabled={busy || previewReadOnly} variant="primary" onClick={() => void save()}>{previewReadOnly ? '此預覽不儲存' : '確認匯入書籍'}</Button></>}</section>
}
