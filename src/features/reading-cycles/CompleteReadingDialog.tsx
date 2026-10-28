import { useEffect, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ReadingCycle } from '../../domain'
import { Button, FormMessage } from '../../shared/ui'
import type { ReadingCycleService } from './reading-cycle-service'

export function CompleteReadingDialog({ cycle, service, onSaved, onClose }: { cycle: ReadingCycle; service: ReadingCycleService; onSaved: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const busy = useRef(false)
  const [saving, setSaving] = useState(false)
  const [date, setDate] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const element = dialog.current
    if (element?.showModal) element.showModal()
    else element?.setAttribute('open', '')
    return () => { element?.close?.(); previous?.focus({ preventScroll: true }) }
  }, [])
  const close = () => { if (!busy.current) onClose() }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      await service.update(cycle.id, {
        status: 'completed', startedAt: cycle.startedAt, finishedAt: cycle.finishedAt,
        completionDate: date ? { precision: 'date', completedOn: date } : null
      }, cycle.revision)
      onSaved(); onClose()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法標記完讀') }
    finally { busy.current = false; setSaving(false) }
  }
  return createPortal(<dialog ref={dialog} className="complete-reading-dialog" aria-labelledby="complete-reading-title" onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation() }} onCancel={event => { event.preventDefault(); close() }}>
    <h3 id="complete-reading-title">第 {cycle.sequence} 次閱讀：標記完讀</h3>
    <form className="entity-form" onSubmit={submit}>
      <label>完讀日期<input disabled={saving} type="date" value={date} onChange={event => setDate(event.target.value)} /></label>
      <p>日期不確定可留白。</p>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="form-actions"><Button disabled={saving} onClick={close}>取消</Button><Button disabled={saving} type="submit" variant="primary">{saving ? '儲存中…' : '確認完讀'}</Button></div>
    </form>
  </dialog>, document.body)
}
