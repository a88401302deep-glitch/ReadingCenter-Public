import { useEffect, useRef, useState, type FormEvent } from 'react'
import { getBookDisplayTitle, type Book, type ReadingProgress } from '../../domain'
import { Button, FormMessage, Modal } from '../../shared/ui'
import { useAuth } from '../auth/auth-context'
import { QuickProgressService, type QuickProgressContext } from './quick-progress-service'

const localTime = () => {
  const date = new Date()
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
export function QuickProgressEditor({ book, service, onClose, onSaved }: {
  book: Book; service: QuickProgressService; onClose: () => void; onSaved: () => void
}) {
  const { previewReadOnly = false } = useAuth()
  const [context, setContext] = useState<QuickProgressContext | null>(null)
  const [unit, setUnit] = useState<ReadingProgress['unit']>('percent')
  const [value, setValue] = useState('')
  const [total, setTotal] = useState('')
  const [initialTime] = useState(localTime)
  const [recordedAt, setRecordedAt] = useState(initialTime)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const [operationId] = useState(() => crypto.randomUUID())
  useEffect(() => {
    let cancelled = false
    void service.load(book.id).then(result => {
      if (cancelled) return
      setContext(result); setUnit(result.progress?.unit ?? 'percent')
      setValue(result.progress?.value.toString() ?? '')
      setTotal(result.progress && result.progress.unit !== 'percent' ? result.progress.total?.toString() ?? '' : '')
      setError('')
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '無法載入進度') })
    return () => { cancelled = true }
  }, [book.id, service, attempt])
  const initial = context?.progress
  const initialTotal = initial && initial.unit !== 'percent' ? initial.total?.toString() ?? '' : ''
  const dirty = context !== null && (unit !== (initial?.unit ?? 'percent') || value !== (initial?.value.toString() ?? '') || total !== initialTotal || recordedAt !== initialTime)
  const mayClose = () => !pending.current && (!dirty || window.confirm('尚有未儲存的進度，確定要離開嗎？'))
  const cancel = () => { if (mayClose()) onClose() }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!context || !dirty || value.trim() === '' || pending.current || previewReadOnly) return
    pending.current = true; setBusy(true); setError('')
    try {
      const date = new Date(recordedAt)
      if (!recordedAt || Number.isNaN(date.getTime())) throw new Error('請填寫有效的紀錄時間')
      const base = { value: Number(value), total: total.trim() ? Number(total) : null }
      const progress: ReadingProgress = unit === 'percent' ? { unit, value: base.value }
        : unit === 'page' ? { unit, ...base }
        : { unit, ...base, label: (initial?.unit === 'chapter' || initial?.unit === 'position') && initial.unit === unit ? initial.label : null }
      await service.save(book.id, operationId, context.token, date.toISOString(), progress)
      onSaved()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法儲存進度') }
    finally { pending.current = false; setBusy(false) }
  }
  return <Modal open title="更新閱讀進度" trapFocus hasUnsavedChanges={dirty || busy} confirmDiscard={mayClose} onClose={onClose}>
    <form className="quick-progress-form" onSubmit={submit}>
      <p className="quick-progress-book">{getBookDisplayTitle(book)}</p>
      {!context ? <>{error ? <FormMessage tone="error">{error}</FormMessage> : <p role="status">正在載入進度…</p>}{error && <Button onClick={() => { setError(''); setAttempt(value => value + 1) }}>重新載入</Button>}<Button onClick={onClose}>取消</Button></> : <>
        {previewReadOnly && <p role="status">唯讀預覽：可核對進度，不會儲存。</p>}
        <fieldset disabled={busy} className="quick-progress-fields">
          <label>進度單位<select value={unit} onChange={event => { setUnit(event.target.value as ReadingProgress['unit']); setValue(''); setTotal('') }}>
            <option value="percent">百分比</option><option value="page">頁數</option><option value="chapter">章數</option>{initial?.unit === 'position' && <option value="position">位置</option>}
          </select></label>
          <label>目前進度<input aria-label="目前進度" required type="number" inputMode="decimal" min="0" max={unit === 'percent' ? 100 : total.trim() ? Number(total) : undefined} step="any" value={value} onChange={event => setValue(event.target.value)} /></label>
          {unit !== 'percent' && <label>{unit === 'page' ? '總頁數（選填）' : unit === 'chapter' ? '總章數（選填）' : '總位置（選填）'}<input aria-label="進度總數" type="number" inputMode="decimal" min="0.000001" step="any" value={total} onChange={event => setTotal(event.target.value)} /></label>}
          <label>紀錄時間<input required type="datetime-local" value={recordedAt} onChange={event => setRecordedAt(event.target.value)} /></label>
        </fieldset>
        <p className="quick-progress-hint">只記錄此時的進度，不計閱讀時長，也不標記完讀。</p>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <div className="form-actions"><Button disabled={busy} onClick={cancel}>取消</Button><Button type="submit" variant="primary" disabled={busy || previewReadOnly || !dirty || value.trim() === ''}>{busy ? '儲存中…' : previewReadOnly ? '此預覽不儲存' : '儲存進度'}</Button></div>
      </>}
    </form>
  </Modal>
}
