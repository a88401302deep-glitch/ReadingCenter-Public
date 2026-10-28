import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Button } from '../../shared/ui/Button'
import { Icon } from '../../shared/ui/Icon'

export function BookMetadataDialog({ children, disabled = false, inline = false }: { children: ReactNode; disabled?: boolean; inline?: boolean }) {
 const [open, setOpen] = useState(false)
 const dialog = useRef<HTMLDialogElement>(null)
 const trigger = useRef<HTMLButtonElement>(null)
 const titleId = useId()
 useEffect(() => {
  if (!open) return
  const panel = dialog.current
  const fields = trigger.current?.closest<HTMLElement>('.book-form-fields')
  const top = fields?.scrollTop ?? 0
  panel?.showModal()
  panel?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  return () => {
   panel?.close()
   trigger.current?.focus({ preventScroll: true })
   if (fields) fields.scrollTop = top
  }
 }, [open])
 const close = () => { if (!disabled) setOpen(false) }
 if (inline) return <section className="book-metadata-inline" aria-label="搜尋並補全書籍資料"><h3>搜尋並補全書籍資料</h3>{children}</section>
 return <>
  <button ref={trigger} className="button button--secondary button--medium" type="button" disabled={disabled} onClick={() => setOpen(true)}>搜尋並補全書籍資料</button>
  <dialog ref={dialog} className="book-metadata-dialog" aria-labelledby={titleId}
   onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'Tab') {
     event.stopPropagation()
     const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]'))
      .filter(control => !control.closest('[hidden], fieldset[disabled]') && control.getClientRects().length > 0)
     const first = controls[0], last = controls[controls.length - 1]
     if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus({ preventScroll: true }) }
     else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus({ preventScroll: true }) }
    }
   }}
   onCancel={event => { event.preventDefault(); event.stopPropagation(); close() }}
   onClick={event => { if (event.target === event.currentTarget) close() }}>
   <header className="book-metadata-dialog-heading"><h2 id={titleId}><Icon name="book" />書目查詢與核對</h2><Button disabled={disabled} aria-label="關閉書目核對" onClick={close}>關閉</Button></header>
   <div className="book-metadata-dialog-content">{children}</div>
   <footer><Button disabled={disabled} onClick={close}>返回編輯表單</Button></footer>
  </dialog>
 </>
}
