import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReadingCenterRepositories, SyncingLocalRepositoryContext } from '../../data'
import { Button } from '../../shared/ui/Button'
import { backupJson, type DeviceBackup } from './backup-export'
import { backupLabels, type VerifiedBackup } from './backup-preview'
import { changedRestoreFields, restoreBackup, restoreRows } from './backup-restore'
const fieldLabels: Record<string, string> = { title: '書名', preferredTitle: '顯示書名', bookNote: '備註', note: '備註', text: '內容', cover: '封面', rating: '評分', authorIds: '作者', creatorIds: '創作者', categoryIds: '分類', tagIds: '標籤', sourceIds: '來源', wordCount: '字數', durationMinutes: '閱讀分鐘', status: '狀態', completionDate: '完讀日期', startedAt: '開始時間', finishedAt: '結束時間', progress: '進度', languageTag: '語言', mediaTypeId: '媒體類型', externalReferences: '原始來源對照' }
export function BackupRestore({ verified, current, repositories, local, onRestored }: {
  verified: VerifiedBackup; current: DeviceBackup; repositories: ReadingCenterRepositories; local?: SyncingLocalRepositoryContext; onRestored?: () => void
}) {
  const rows = useMemo(() => restoreRows(verified.backup, current), [verified, current])
  const [selected, setSelected] = useState<Set<string>>(new Set()), [query, setQuery] = useState(''), [limit, setLimit] = useState(40)
  const [download, setDownload] = useState<string | null>(null), [downloaded, setDownloaded] = useState(false), [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(''), [done, setDone] = useState(false)
  const controller = useRef<AbortController | null>(null), urlRef = useRef<string | null>(null)
  useEffect(() => () => { controller.current?.abort(); if (urlRef.current) URL.revokeObjectURL(urlRef.current) }, [])
  const prepareDownload = () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    const url = URL.createObjectURL(new Blob([backupJson(current)], { type: 'application/json' }))
    urlRef.current = url; setDownload(url); setDownloaded(false); setConfirmed(false)
  }
  const filtered = rows.filter(row => `${row.title} ${backupLabels[row.collection]} ${row.id}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const toggle = (key: string) => { setSelected(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next }); setConfirmed(false) }
  const apply = async () => {
    if (busy || done || !selected.size || !downloaded || !confirmed) return
    setBusy(true); setError(''); setMessage('正在還原選定資料…')
    const task = new AbortController(); controller.current = task
    try {
      const count = await restoreBackup({ repositories, verified, expected: current, selected, local, signal: task.signal })
      onRestored?.()
      if (!task.signal.aborted) { setDone(true); setMessage(`已在此裝置合併還原 ${count} 筆資料；其他資料保留。${local ? '跨裝置結果請確認頁面上方同步狀態。' : ''}`) }
    } catch (reason) { if (!task.signal.aborted) { setError(reason instanceof Error ? reason.message : '還原失敗，請保留備份'); setMessage('') } }
    finally { if (!task.signal.aborted) setBusy(false) }
  }
  return <div className="backup-restore" aria-label="合併還原核對">
    <h3>選擇要合併還原的資料</h3>
    <p>預設全部保留目前資料。勾選新增項目即可加入；勾選內容不同的項目，會採用備份內容，請先展開核對備註、評分等差異。未勾選及僅目前裝置有的資料都會保留。既有人工資料的來源標記與建立時間會保留。</p>
    <div className="form-actions"><Button disabled={busy || done} onClick={() => { setSelected(new Set(rows.filter(row => row.status === 'new').map(row => row.key))); setConfirmed(false) }}>選取所有新增資料</Button><Button disabled={busy || done} onClick={() => { setSelected(new Set()); setConfirmed(false) }}>清除選取</Button></div>
    <label>搜尋還原項目<input value={query} onChange={event => { setQuery(event.target.value); setLimit(40) }} /></label>
    <p>待核對 {rows.length} 筆，已選 {selected.size} 筆。僅版本時間不同、內容相同的項目不需重複還原。</p>
    {filtered.slice(0, limit).map(row => <div key={row.key} className="backup-restore-row">
      <label><input type="checkbox" checked={selected.has(row.key)} disabled={busy || done} onChange={() => toggle(row.key)} />{row.title}（{backupLabels[row.collection]}／{row.status === 'new' ? '新增' : '內容不同'}）</label>
      {row.status === 'different' && <details><summary>查看內容差異</summary>{changedRestoreFields(row).map(field => <div key={field.key}><strong>{fieldLabels[field.key] ?? field.key}</strong><p>目前：{JSON.stringify(field.before) ?? '未提供'}</p><p>備份：{JSON.stringify(field.after) ?? '未提供'}</p></div>)}</details>}
    </div>)}
    {filtered.length > limit && <Button onClick={() => setLimit(value => value + 40)}>顯示更多還原項目</Button>}
    {rows.length === 0 && <p>備份內容與目前資料相同，沒有需要還原的項目。</p>}
    {rows.length > 0 && <>
      {!download && <Button disabled={busy || done} onClick={prepareDownload}>準備還原前資料備份</Button>}
      {download && <a href={download} download={`readingcenter-before-restore-${current.generatedAt.replaceAll(':', '-')}.json`} onClick={() => setDownloaded(true)}>下載還原前資料備份</a>}
      <p>先保存目前資料備份。這份 JSON 保留資料與封面參照，不含圖片；如需圖片，可先使用上方「下載資料備份」。</p>
      <label><input type="checkbox" disabled={busy || done || !downloaded || !selected.size} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />已保存還原前備份，並核對所選資料的差異</label>
      <Button disabled={busy || done || !downloaded || !confirmed || !selected.size} onClick={() => void apply()}>{busy ? '正在還原…' : '合併還原所選資料'}</Button>
    </>}
    {message && <p role="status">{message}</p>}{error && <p role="alert" className="form-message form-message--error">{error}</p>}
  </div>
}
