import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { ReadingCycle, ReadingCycleStatus } from '../../domain'
import { Button, FormMessage } from '../../shared/ui'
import { ReadingCycleService, type ReadingCycleDeletionImpact } from './reading-cycle-service'
import { ReadingRecordPopover } from '../reading-records/ReadingRecordPopover'
import type { ReadingRecordService } from '../reading-records/reading-record-service'
import { ReadingContentManager } from '../reading-contents/ReadingContentManager'
import type { ReadingContentService } from '../reading-contents/reading-content-service'

interface Props { readingSummary?: ReactNode; compact?: boolean; revision?: number; bookId: string; service: ReadingCycleService; recordService: ReadingRecordService; contentService: ReadingContentService; onContentChanged?: () => void; onReadingChanged?: () => void }
const statusLabel: Record<ReadingCycleStatus, string> = { planned: '預計閱讀', reading: '閱讀中', paused: '暫停', completed: '已讀完', abandoned: '已棄讀' }
const toInput = (value: string | null) => value?.slice(0, 16) ?? ''
const toIso = (value: string) => value ? new Date(value).toISOString() : null
const cycleDateLabel = (cycle: ReadingCycle) => {
  const date = cycle.completionDate
  if (date) {
    if (date.precision === 'range') return `完讀日期範圍：${date.startedOn}－${date.completedOn}`
    if (date.precision === 'minute') {
      const offset = Math.abs(date.offsetMinutes)
      const zone = `UTC${date.offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(offset / 60)).padStart(2, '0')}:${String(offset % 60).padStart(2, '0')}`
      return `完讀：${date.completedOn} ${date.localTime}（${zone}）`
    }
    return `完讀：${date.completedOn}`
  }
  if (cycle.startedAt) return `${cycle.startedAt.slice(0, 10)}${cycle.finishedAt ? `－${cycle.finishedAt.slice(0, 10)}` : ''}`
  return cycle.finishedAt ? `結束：${cycle.finishedAt.slice(0, 10)}` : '日期未設定'
}

export function ReadingCycleManager({ readingSummary, compact = false, revision = 0, bookId, contentService, onContentChanged, onReadingChanged, recordService, service }: Props) {
  const [cycles, setCycles] = useState<ReadingCycle[]>([])
  const [editing, setEditing] = useState<ReadingCycle | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<{ cycle: ReadingCycle; impact: ReadingCycleDeletionImpact } | null>(null)
  const [status, setStatus] = useState<ReadingCycleStatus>('reading')
  const [startedAt, setStartedAt] = useState('')
  const [finishedAt, setFinishedAt] = useState('')
  const [completedOn, setCompletedOn] = useState('')
  const [readingDays, setReadingDays] = useState('')
  const [totalMinutes, setTotalMinutes] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reload = async () => setCycles(await service.listForBook(bookId))
  useEffect(() => {
    let cancelled = false
    void service.listForBook(bookId).then((items) => { if (!cancelled) setCycles(items) })
    return () => { cancelled = true }
  }, [bookId, service, revision])
  const openForm = (cycle: ReadingCycle | null) => { setEditing(cycle); setStatus(cycle?.status ?? 'reading'); setStartedAt(toInput(cycle?.startedAt ?? null)); setFinishedAt(toInput(cycle?.finishedAt ?? null)); setCompletedOn(cycle?.completionDate?.precision === 'date' ? cycle.completionDate.completedOn : ''); setReadingDays(cycle?.reportedReadingDays?.toString() ?? ''); setTotalMinutes(cycle?.reportedDurationMinutes?.toString() ?? ''); setReason(cycle?.abandonedReason ?? ''); setError(null) }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    try { const completionDate = status !== 'completed' ? null : editing?.completionDate && editing.completionDate.precision !== 'date' ? editing.completionDate : completedOn ? { precision: 'date' as const, completedOn } : null; const draft = { status, completionDate, startedAt: toIso(startedAt), finishedAt: toIso(finishedAt), reportedDurationMinutes: totalMinutes === '' ? null : Number(totalMinutes), reportedReadingDays: readingDays === '' ? null : Number(readingDays), abandonedReason: reason }; if (editing) await service.update(editing.id, draft, editing.revision); else await service.create(bookId, draft); await reload(); onReadingChanged?.(); setEditing(undefined) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '無法儲存閱讀週期') }
  }
  const requestDelete = async (cycle: ReadingCycle) => setDeleting({ cycle, impact: await service.deletionImpact(cycle.id) })
  const confirmDelete = async () => { if (!deleting) return; await service.delete(deleting.cycle.id); await reload(); onReadingChanged?.(); setDeleting(null) }
  const controls = <>
    <div className="section-heading"><h3>閱讀狀態與重讀</h3><div className="cycle-heading-actions"><ReadingRecordPopover revision={revision} bookId={bookId} cycleId={null} service={recordService} onChanged={onReadingChanged} /><Button size="small" onClick={() => openForm(null)}>新增一次閱讀</Button></div></div>
    {cycles.length === 0 ? <p className="empty-line">尚無手動設定的閱讀狀態</p> : <ol className="cycle-list">{cycles.map((cycle) => <li key={cycle.id}><div><strong>第 {cycle.sequence} 次閱讀</strong><span>{statusLabel[cycle.status]}</span><small>{cycleDateLabel(cycle)}</small>{cycle.reportedDurationMinutes != null && <small>整次閱讀累計 {cycle.reportedDurationMinutes} 分鐘（每日分布未知）</small>}{cycle.reportedReadingDays != null && <small>來源回報閱讀 {cycle.reportedReadingDays} 天</small>}</div><div><ReadingRecordPopover revision={revision} bookId={bookId} cycleId={cycle.id} cycleSequence={cycle.sequence} service={recordService} onChanged={onReadingChanged} /><Button size="small" onClick={() => openForm(cycle)}>編輯</Button><Button size="small" variant="danger" onClick={() => void requestDelete(cycle)}>刪除</Button></div></li>)}</ol>}
    {editing !== undefined && <form className="entity-form cycle-form" onSubmit={submit}><label>狀態<select value={status} onChange={(event) => setStatus(event.target.value as ReadingCycleStatus)}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>開始時間<input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label><label>結束時間<input type="datetime-local" value={finishedAt} onChange={(event) => setFinishedAt(event.target.value)} /></label>{status === 'completed' && (!editing?.completionDate || editing.completionDate.precision === 'date') && <label>完讀日期<input type="date" value={completedOn} onChange={(event) => setCompletedOn(event.target.value)} /></label>}<label>閱讀天數<input type="number" min="1" step="1" value={readingDays} onChange={(event) => setReadingDays(event.target.value)} placeholder="未記錄" /></label><label>整次閱讀累計分鐘<input type="number" min="0" step="1" value={totalMinutes} onChange={event => setTotalMinutes(event.target.value)} placeholder="未記錄" /></label>{status === 'abandoned' && <label>棄讀原因<input required value={reason} onChange={(event) => setReason(event.target.value)} /></label>}{error && <FormMessage tone="error">{error}</FormMessage>}<div className="form-actions"><Button onClick={() => setEditing(undefined)}>取消</Button><Button type="submit" variant="primary">儲存</Button></div></form>}
    {deleting && <div className="delete-confirmation"><p>確定刪除第 {deleting.cycle.sequence} 次閱讀？</p><ul><li>{deleting.impact.readingRecords} 筆閱讀紀錄</li><li>{deleting.impact.readingContents} 筆閱讀內容</li></ul><div className="form-actions"><Button onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" onClick={() => void confirmDelete()}>確認刪除</Button></div></div>}
  </>
  return <section className="cycle-manager">
    {readingSummary ? <section className="book-detail-reading" aria-label="閱讀紀錄"><h3>閱讀紀錄</h3>{readingSummary}{compact ? <details className="book-reading-management"><summary>修改狀態／重讀</summary>{controls}</details> : controls}</section> : compact ? <details className="book-reading-management"><summary>修改狀態／重讀</summary>{controls}</details> : controls}
    <ReadingContentManager heading={readingSummary ? '心得與畫線' : undefined} revision={revision} bookId={bookId} cycles={cycles} onChanged={onContentChanged} service={contentService} />
  </section>
}


