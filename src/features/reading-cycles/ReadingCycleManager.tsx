import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { ReadingCycle, ReadingCycleStatus, ReadingRecord } from '../../domain'
import { Button, FormMessage, Icon } from '../../shared/ui'
import { ReadingCycleService, type ReadingCycleDeletionImpact } from './reading-cycle-service'
import { CompleteReadingDialog } from './CompleteReadingDialog'
import { BookReadingCycles } from './BookReadingCycles'
import { statusLabel, cycleDateLabel } from './reading-cycle-labels'
import { ReadingRecordPopover } from '../reading-records/ReadingRecordPopover'
import type { ReadingRecordService } from '../reading-records/reading-record-service'
import { ReadingContentManager } from '../reading-contents/ReadingContentManager'
import type { ReadingContentService } from '../reading-contents/reading-content-service'

interface Props { readingSummary?: ReactNode; readingStatus?: ReactNode; readingActions?: ReactNode; compact?: boolean; revision?: number; bookId: string; service: ReadingCycleService; recordService: ReadingRecordService; contentService: ReadingContentService; onContentChanged?: () => void; onReadingChanged?: () => void }
const toInput = (value: string | null) => value?.slice(0, 16) ?? ''
const toIso = (value: string) => value ? new Date(value).toISOString() : null

export function ReadingCycleManager({ readingSummary, readingStatus, readingActions, compact = false, revision = 0, bookId, contentService, onContentChanged, onReadingChanged, recordService, service }: Props) {
  const [editingRecordIds, setEditingRecordIds] = useState<Set<string | null>>(() => new Set())
  const recordEditingChanged = useCallback((cycleId: string | null, active: boolean) => {
    setEditingRecordIds(previous => {
      if (previous.has(cycleId) === active) return previous
      const next = new Set(previous)
      if (active) next.add(cycleId)
      else next.delete(cycleId)
      return next
    })
  }, [])
  const [managing, setManaging] = useState(false)
  const browseFirst = compact && Boolean(readingSummary)
  const showActions = !browseFirst || managing
  const [completing, setCompleting] = useState<ReadingCycle | null>(null)
  const [records, setRecords] = useState<ReadingRecord[]>([])
  const [loadError, setLoadError] = useState('')
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
  const load = async () => {
    const [items, entries] = await Promise.all([service.listForBook(bookId), compact ? recordService.listForBook(bookId) : Promise.resolve([] as ReadingRecord[])])
    return { items, entries }
  }
  const reload = async () => { const result = await load(); setCycles(result.items); setRecords(result.entries); setLoadError('') }
  const recordsChanged = () => { void reload().catch(() => setLoadError('閱讀紀錄載入失敗，請重新開啟書籍')); onReadingChanged?.() }
  useEffect(() => {
    let cancelled = false
    void Promise.all([service.listForBook(bookId), compact ? recordService.listForBook(bookId) : Promise.resolve([] as ReadingRecord[])]).then(([items, entries]) => {
      if (!cancelled) { setCycles(items); setRecords(entries); setLoadError('') }
    }).catch(() => { if (!cancelled) setLoadError('閱讀紀錄載入失敗，請重新開啟書籍') })
    return () => { cancelled = true }
  }, [bookId, compact, recordService, service, revision])
  const openForm = (cycle: ReadingCycle | null) => { setEditing(cycle); setStatus(cycle?.status ?? 'reading'); setStartedAt(toInput(cycle?.startedAt ?? null)); setFinishedAt(toInput(cycle?.finishedAt ?? null)); setCompletedOn(cycle?.completionDate?.precision === 'date' ? cycle.completionDate.completedOn : ''); setReadingDays(cycle?.reportedReadingDays?.toString() ?? ''); setTotalMinutes(cycle?.reportedDurationMinutes?.toString() ?? ''); setReason(cycle?.abandonedReason ?? ''); setError(null) }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(null)
    try { const completionDate = status !== 'completed' ? null : editing?.completionDate && editing.completionDate.precision !== 'date' ? editing.completionDate : completedOn ? { precision: 'date' as const, completedOn } : null; const draft = { status, completionDate, startedAt: toIso(startedAt), finishedAt: toIso(finishedAt), reportedDurationMinutes: totalMinutes === '' ? null : Number(totalMinutes), reportedReadingDays: readingDays === '' ? null : Number(readingDays), abandonedReason: reason }; if (editing) await service.update(editing.id, draft, editing.revision); else await service.create(bookId, draft); await reload(); onReadingChanged?.(); setEditing(undefined) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '無法儲存閱讀週期') }
  }
  const requestDelete = async (cycle: ReadingCycle) => setDeleting({ cycle, impact: await service.deletionImpact(cycle.id) })
  const confirmDelete = async () => { if (!deleting) return; await service.delete(deleting.cycle.id); await reload(); onReadingChanged?.(); setDeleting(null) }
  const controls = <>
    {loadError && <p role="alert">{loadError}</p>}
    {compact ? <BookReadingCycles showActions={showActions} onRecordEditingChange={recordEditingChanged} onComplete={setCompleting} cycles={cycles} records={records} bookId={bookId} revision={revision} recordService={recordService} onRecordsChanged={recordsChanged} onEdit={openForm} onDelete={cycle => void requestDelete(cycle)} /> : <>
    <div className="section-heading"><h3>閱讀狀態與重讀</h3><div className="cycle-heading-actions"><ReadingRecordPopover revision={revision} bookId={bookId} cycleId={null} service={recordService} onChanged={onReadingChanged} /><Button size="small" onClick={() => openForm(null)}>新增一次閱讀</Button></div></div>
    {cycles.length === 0 ? <p className="empty-line">尚無手動設定的閱讀狀態</p> : <ol className="cycle-list">{cycles.map((cycle) => <li key={cycle.id}><div><strong>第 {cycle.sequence} 次閱讀</strong><span>{statusLabel[cycle.status]}</span><small>{cycleDateLabel(cycle)}</small>{cycle.reportedDurationMinutes != null && <small>整次閱讀累計 {cycle.reportedDurationMinutes} 分鐘</small>}{cycle.reportedReadingDays != null && <small>閱讀 {cycle.reportedReadingDays} 天</small>}</div><div><ReadingRecordPopover revision={revision} bookId={bookId} cycleId={cycle.id} cycleSequence={cycle.sequence} service={recordService} onChanged={onReadingChanged} /><Button size="small" onClick={() => openForm(cycle)}>編輯</Button><Button size="small" variant="danger" onClick={() => void requestDelete(cycle)}>刪除</Button></div></li>)}</ol>}
    </>}
    {editing !== undefined && <form className="entity-form cycle-form" onSubmit={submit}><label>狀態<select value={status} onChange={(event) => setStatus(event.target.value as ReadingCycleStatus)}>{Object.entries(statusLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>開始時間<input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} /></label><label>結束時間<input type="datetime-local" value={finishedAt} onChange={(event) => setFinishedAt(event.target.value)} /></label>{status === 'completed' && (!editing?.completionDate || editing.completionDate.precision === 'date') && <label>完讀日期<input type="date" value={completedOn} onChange={(event) => setCompletedOn(event.target.value)} /></label>}<label>閱讀天數<input type="number" min="1" step="1" value={readingDays} onChange={(event) => setReadingDays(event.target.value)} placeholder="未記錄" /></label><label>整次閱讀累計分鐘<input type="number" min="0" step="1" value={totalMinutes} onChange={event => setTotalMinutes(event.target.value)} placeholder="未記錄" /></label>{status === 'abandoned' && <label>棄讀原因<input required value={reason} onChange={(event) => setReason(event.target.value)} /></label>}{error && <FormMessage tone="error">{error}</FormMessage>}<div className="form-actions"><Button onClick={() => setEditing(undefined)}>取消</Button><Button type="submit" variant="primary">儲存</Button></div></form>}
    {deleting && <div className="delete-confirmation"><p>確定刪除第 {deleting.cycle.sequence} 次閱讀？</p><ul><li>{deleting.impact.readingRecords} 筆閱讀紀錄</li><li>{deleting.impact.readingContents} 筆閱讀內容</li></ul><div className="form-actions"><Button onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" onClick={() => void confirmDelete()}>確認刪除</Button></div></div>}
  </>
  return <section className="cycle-manager">
    {completing && <CompleteReadingDialog cycle={completing} service={service} onSaved={recordsChanged} onClose={() => setCompleting(null)} />}
    {readingSummary ? <section className="book-detail-reading book-detail-panel" aria-label="閱讀紀錄"><div className="book-detail-panel-heading"><h3><Icon name="list" />閱讀紀錄</h3>{browseFirst && <Button size="small" variant="ghost" aria-pressed={managing} disabled={editing !== undefined || deleting !== null || editingRecordIds.size > 0} onPointerDown={event => event.stopPropagation()} onClick={() => setManaging(value => !value)}>{managing ? '完成閱讀管理' : '管理閱讀'}</Button>}</div>{showActions ? readingActions : readingStatus}{readingSummary}{compact ? <div className="book-reading-management">{controls}</div> : controls}</section> : compact ? <div className="book-reading-management">{controls}</div> : controls}
    <ReadingContentManager browseFirst={browseFirst} heading={readingSummary ? '閱讀心得' : undefined} revision={revision} bookId={bookId} cycles={cycles} onChanged={onContentChanged} service={contentService} />
  </section>
}


