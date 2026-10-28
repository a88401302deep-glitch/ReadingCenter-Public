import { useEffect, useState, type FormEvent } from 'react'
import type { ReadingProgress, ReadingRecord } from '../../domain'
import { Button, FormMessage, Popover } from '../../shared/ui'
import { ReadingRecordService } from './reading-record-service'

interface Props { onEditingChange?: (cycleId: string | null, active: boolean) => void; onMarkCompleted?: () => void; triggerLabel?: string; revision?: number; bookId: string; cycleId: string | null; cycleSequence?: number; onChanged?: () => void; service: ReadingRecordService }
type ProgressUnit = ReadingProgress['unit']

const toInput = (value: string | null) => value?.slice(0, 16) ?? ''
const toIso = (value: string) => new Date(value).toISOString()

export function ReadingRecordPopover({ onEditingChange, onMarkCompleted, triggerLabel = '手動補登', revision = 0, bookId, cycleId, cycleSequence, onChanged, service }: Props) {
  const [records, setRecords] = useState<ReadingRecord[]>([])
  const [editing, setEditing] = useState<ReadingRecord | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<ReadingRecord | null>(null)
  const editingActive = editing !== undefined || deleting !== null
  useEffect(() => {
    onEditingChange?.(cycleId, editingActive)
    return () => onEditingChange?.(cycleId, false)
  }, [cycleId, editingActive, onEditingChange])
  const [startedAt, setStartedAt] = useState('')
  const [endedAt, setEndedAt] = useState('')
  const [duration, setDuration] = useState('')
  const [unit, setUnit] = useState<ProgressUnit>('percent')
  const [value, setValue] = useState('')
  const [total, setTotal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reload = async () => setRecords((await service.listForBook(bookId)).filter((record) => record.cycleId === cycleId))
  useEffect(() => {
    let cancelled = false
    void service.listForBook(bookId).then((items) => { if (!cancelled) setRecords(items.filter((record) => record.cycleId === cycleId)) })
    return () => { cancelled = true }
  }, [bookId, cycleId, service, revision])
  const openForm = (record: ReadingRecord | null) => {
    setEditing(record); setStartedAt(toInput(record?.startedAt ?? null)); setEndedAt(toInput(record?.endedAt ?? null))
    setDuration(record?.durationMinutes?.toString() ?? ''); setUnit(record?.progress?.unit ?? 'percent')
    setValue(record?.progress?.value.toString() ?? ''); setTotal(record?.progress && record.progress.unit !== 'percent' ? record.progress.total?.toString() ?? '' : ''); setError(null)
  }
  const buildProgress = (): ReadingProgress | null => {
    if (!value.trim()) return null
    const numericValue = Number(value)
    if (unit === 'percent') return { unit, value: numericValue }
    const numericTotal = total.trim() ? Number(total) : null
    if (unit === 'page') return { unit, value: numericValue, total: numericTotal }
    return { unit, value: numericValue, total: numericTotal, label: null }
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    try {
      const draft = { cycleId, startedAt: toIso(startedAt), endedAt: endedAt ? toIso(endedAt) : null, durationMinutes: duration.trim() ? Number(duration) : null, progress: buildProgress() }
      if (editing) await service.update(editing.id, draft, editing.revision); else await service.create(bookId, draft)
      await reload(); onChanged?.(); setEditing(undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法儲存閱讀紀錄') }
  }
  const confirmDelete = async () => { if (!deleting) return; await service.delete(deleting.id); await reload(); onChanged?.(); setDeleting(null) }
  const label = cycleSequence ? `第 ${cycleSequence} 次閱讀紀錄` : '未歸類閱讀紀錄'
  return <Popover label={label} trigger={(props) => <Button size="small" variant="ghost" {...props}>{triggerLabel}（{records.length}）</Button>} content={<div className="record-popover">
    <div className="record-heading"><strong>{label}</strong>{onMarkCompleted && <Button size="small" onClick={onMarkCompleted}>標記完讀</Button>}<Button size="small" onClick={() => openForm(null)}>新增紀錄</Button></div>
    {records.length === 0 ? <p className="empty-line">尚無閱讀紀錄</p> : <ul className="record-list">{records.map((record) => <li key={record.id}><div><time>{record.startedAt.replace('T', ' ').slice(0, 16)}</time><span>{record.durationMinutes === null ? '時間未設定' : `${record.durationMinutes} 分鐘`}</span><span>{record.progress ? `${record.progress.value}${record.progress.unit === 'percent' ? '%' : ` ${record.progress.unit}`}` : '進度未設定'}</span></div><div><Button size="small" onClick={() => openForm(record)}>編輯</Button><Button size="small" variant="danger" onClick={() => setDeleting(record)}>刪除</Button></div></li>)}</ul>}
    {editing !== undefined && <form className="entity-form record-form" onSubmit={submit}><label>開始時間<input required type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label><label>結束時間<input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} /></label><label>閱讀時間（分鐘）<input min="0" step="1" type="number" value={duration} onChange={(event) => setDuration(event.target.value)} /></label><div className="record-progress"><label>進度單位<select value={unit} onChange={(event) => setUnit(event.target.value as ProgressUnit)}><option value="percent">百分比</option><option value="page">頁</option><option value="chapter">章</option><option value="position">位置</option></select></label><label>目前進度<input min="0" type="number" value={value} onChange={(event) => setValue(event.target.value)} /></label>{unit !== 'percent' && <label>總數<input min="1" type="number" value={total} onChange={(event) => setTotal(event.target.value)} /></label>}</div>{error && <FormMessage tone="error">{error}</FormMessage>}<div className="form-actions"><Button onClick={() => setEditing(undefined)}>取消</Button><Button type="submit" variant="primary">儲存</Button></div></form>}
    {deleting && <div className="delete-confirmation"><p>確定刪除這筆閱讀紀錄？相關畫線與心得會保留。</p><div className="form-actions"><Button onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" onClick={() => void confirmDelete()}>確認刪除</Button></div></div>}
  </div>} />
}

