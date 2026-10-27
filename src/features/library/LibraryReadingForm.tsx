import { useState, type FormEvent } from 'react'
import type { ReadingCycle } from '../../domain'
import { Button, FormMessage } from '../../shared/ui'
import type { ReadingRecordDraft } from '../reading-records/reading-record-service'
import type { ReadingContentDraft } from '../reading-contents/reading-content-service'

export type LibraryEntryKind = 'record' | 'shortReview'
export function LibraryReadingForm({ kind, cycles, busy, error, onDirtyChange, onCancel, onSubmit }: {
  kind: LibraryEntryKind; cycles: ReadingCycle[]; busy: boolean; error: string | null
  onDirtyChange: (dirty: boolean) => void; onCancel: () => void
  onSubmit: (draft: ReadingRecordDraft | ReadingContentDraft) => Promise<void>
}) {
  const [cycleId, setCycleId] = useState(() => { const reading = cycles.filter(cycle => cycle.status === 'reading'); return reading.length === 1 ? reading[0].id : '' })
  const [startedAt, setStartedAt] = useState('')
  const [endedAt, setEndedAt] = useState('')
  const [duration, setDuration] = useState('')
  const [progress, setProgress] = useState('')
  const [text, setText] = useState('')
  const [recordedForAt, setRecordedForAt] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    void onSubmit(kind === 'record'
      ? { cycleId: cycleId || null, startedAt: new Date(startedAt).toISOString(), endedAt: endedAt ? new Date(endedAt).toISOString() : null, durationMinutes: duration === '' ? null : Number(duration), progress: progress === '' ? null : { unit: 'percent', value: Number(progress) } }
      : { type: 'shortReview', cycleId: cycleId || null, text, recordedForAt: recordedForAt ? new Date(recordedForAt).toISOString() : null })
  }
  return <form className="entity-form" onSubmit={submit} onChange={() => onDirtyChange(true)}>
    <h3>{kind === 'record' ? '新增閱讀紀錄' : '新增短評'}</h3>
    {error && <FormMessage tone="error">{error}</FormMessage>}
    <fieldset disabled={busy} className="library-entry-fields">
      <label>閱讀週期<select value={cycleId} onChange={event => setCycleId(event.target.value)}><option value="">不指定</option>{cycles.map(cycle => <option key={cycle.id} value={cycle.id}>第 {cycle.sequence} 次閱讀</option>)}</select></label>
      {kind === 'record' ? <>
        <label>開始時間<input autoFocus required type="datetime-local" value={startedAt} onChange={event => setStartedAt(event.target.value)} /></label>
        <label>結束時間<input type="datetime-local" value={endedAt} onChange={event => setEndedAt(event.target.value)} /></label>
        <label>閱讀時間（分鐘）<input type="number" min="0" step="1" value={duration} onChange={event => setDuration(event.target.value)} /></label>
        <label>閱讀進度（%）<input type="number" min="0" max="100" step="any" value={progress} onChange={event => setProgress(event.target.value)} /></label>
      </> : <>
        <label>短評內容<textarea autoFocus required value={text} onChange={event => setText(event.target.value)} /></label>
        <label>內容時間<input type="datetime-local" value={recordedForAt} onChange={event => setRecordedForAt(event.target.value)} /></label>
        <p>沒有確切日期可留空，儲存時間不會作為短評日期。</p>
      </>}
    </fieldset>
    <div className="form-actions"><Button disabled={busy} onClick={onCancel}>取消</Button><Button disabled={busy} type="submit" variant="primary">{busy ? '儲存中…' : '儲存'}</Button></div>
  </form>
}
