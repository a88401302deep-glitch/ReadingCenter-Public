import { useEffect, useRef, useState } from 'react'
import type { ReadingCenterRepositories, SyncingLocalRepositoryContext } from '../../data'
import { captureDeviceBackup, type DeviceBackup } from './backup-export'
import { backupLabels, compareBackups, inspectBackup, type VerifiedBackup } from './backup-preview'
import './backup-export.css'
import { BackupRestore } from './BackupRestore'

export function BackupPreview({ repositories, local, onRestored }: { repositories: ReadingCenterRepositories; local?: SyncingLocalRepositoryContext; onRestored?: () => void }) {
  const [result, setResult] = useState<{ verified: VerifiedBackup; diff: ReturnType<typeof compareBackups>; current: DeviceBackup; generation: number } | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [restored, setRestored] = useState(false)
  const task = useRef(0)
  useEffect(() => () => { task.current++ }, [])
  const inspect = async (file: File | undefined) => {
    const sequence = ++task.current
    setResult(null); setError(''); setRestored(false); setBusy(Boolean(file))
    if (!file) return
    try {
      const verified = await inspectBackup(file)
      const current = await captureDeviceBackup(repositories)
      if (sequence === task.current) setResult({ verified, diff: compareBackups(verified.backup, current), current, generation: sequence })
    } catch (reason) { if (sequence === task.current) setError(reason instanceof Error ? reason.message : '無法讀取備份') }
    finally { if (sequence === task.current) setBusy(false) }
  }
  return <section className="notion-preview-picker backup-export" aria-label="備份驗證與還原預覽">
    <h2>檢查備份與還原預覽</h2>
    <p>選擇閱讀中心下載的 JSON 或 ZIP。選檔只會檢查與比較；下方可核對並合併還原選定資料。</p>
    <label>選擇閱讀中心備份<input type="file" accept=".json,.zip,application/json,application/zip" onChange={event => void inspect(event.target.files?.[0])} /></label>
    {busy && <p role="status">正在驗證備份與封面…</p>}
    {error && <p role="alert" className="form-message form-message--error">{error}</p>}
    {result && <>
      <p role="status">{restored ? '備份檔驗證完成。' : '備份檔驗證完成，尚未還原。'}</p>
      <p>備份時間：{result.verified.backup.generatedAt}；封面圖片 {result.verified.includedCovers} 張，僅參照 {result.verified.referenceCovers} 張。</p>
      {result.verified.referenceCovers > 0 && <p>僅參照的封面未包含圖片檔，未確認網址目前是否仍可讀取。</p>}
      {result.verified.warnings.map(warning => <p key={warning} role="alert">{warning}</p>)}
      <div className="backup-table-scroll"><table><caption>{restored ? '還原前資料差異' : '以資料識別碼比較目前裝置與備份'}</caption><thead><tr><th>資料</th><th>備份新增</th><th>內容不同</th><th>相同</th><th>僅目前裝置有</th></tr></thead><tbody>{result.diff.map(row => <tr key={row.key}><th scope="row">{backupLabels[row.key]}</th><td>{row.added}</td><td>{row.changed}</td><td>{row.same}</td><td>{row.currentOnly}</td></tr>)}</tbody></table></div>
      <p>同名而識別碼不同的書籍仍會分開計數，請留意是否為同一本書。</p>
      <BackupRestore key={result.generation} verified={result.verified} current={result.current} repositories={repositories} local={local} onRestored={() => { setRestored(true); onRestored?.() }} />
    </>}
  </section>
}
