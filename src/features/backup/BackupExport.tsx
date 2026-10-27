import { useEffect, useRef, useState } from 'react'
import type { ReadingCenterRepositories } from '../../data/repository'
import { Button } from '../../shared/ui/Button'
import { backupJson, captureDeviceBackup, prepareBackupArchive } from './backup-export'
import './backup-export.css'

export function BackupExport({ repositories }: { repositories: ReadingCenterRepositories }) {
  const [includeCovers, setIncludeCovers] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [download, setDownload] = useState<{ url: string; name: string } | null>(null)
  const controller = useRef<AbortController | null>(null)
  const urlRef = useRef<string | null>(null)
  useEffect(() => () => { controller.current?.abort(); if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])
  const prepare = async () => {
    if (busy) return
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null }
    setDownload(null); setError(''); setBusy(true); setMessage('正在讀取資料…')
    const task = new AbortController()
    controller.current = task
    try {
      const snapshot = await captureDeviceBackup(repositories)
      task.signal.throwIfAborted()
      let blob: Blob
      let referenceCount = 0
      if (includeCovers) {
        const archive = await prepareBackupArchive(snapshot, { signal: task.signal, onProgress: (done, total) => setMessage(`準備封面 ${done}／${total}`) })
        blob = archive.blob
        referenceCount = archive.assets.filter(asset => asset.status === 'reference-only').length
      } else blob = new Blob([backupJson(snapshot)], { type: 'application/json' })
      task.signal.throwIfAborted()
      const url = URL.createObjectURL(blob)
      urlRef.current = url
      const timestamp = snapshot.generatedAt.replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
      setDownload({ url, name: `readingcenter-device-${timestamp}.${includeCovers ? 'zip' : 'json'}` })
      setMessage(`已準備 ${snapshot.counts.books} 本書、${snapshot.counts.readingRecords} 筆閱讀紀錄、${snapshot.counts.sourceReadingDays} 筆來源每日統計。${referenceCount ? `另有 ${referenceCount} 個外部封面僅保留網址，未打包圖片。` : ''}`)
    } catch (reason) {
      if (!task.signal.aborted) { setError(reason instanceof Error ? reason.message : '無法準備備份'); setMessage('') }
    } finally { if (!task.signal.aborted) setBusy(false); if (controller.current === task) controller.current = null }
  }
  return <section className="notion-preview-picker backup-export" aria-label="裝置資料備份">
    <h2>下載資料備份</h2>
    <p className="notion-preview-note">保存此裝置目前的資料；同步完成後下載，可包含其他裝置的更新。還原前請先保存目前資料。</p>
    <label><input type="checkbox" checked={includeCovers} disabled={busy} onChange={event => { setIncludeCovers(event.target.checked); if (urlRef.current) URL.revokeObjectURL(urlRef.current); urlRef.current = null; setDownload(null); setMessage(''); setError('') }} /> 連同封面圖片打包（ZIP）</label>
    <div className="form-actions"><Button disabled={busy} onClick={() => void prepare()}>{busy ? '正在準備…' : includeCovers ? '準備含封面備份' : '準備資料 JSON'}</Button>{download && <a href={download.url} download={download.name}>下載備份</a>}</div>
    {!includeCovers && <p className="notion-preview-note">JSON 保留封面參照，不包含圖片檔。</p>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="form-message form-message--error">{error}</p>}
  </section>
}
