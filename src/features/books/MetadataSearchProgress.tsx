import { useEffect, useId, useRef } from 'react'
import { Button } from '../../shared/ui/Button'
import { Icon } from '../../shared/ui/Icon'
import './metadata-search-progress.css'

export function MetadataSearchProgress({ onCancel }: { onCancel: () => void }) {
 const dialog = useRef<HTMLDialogElement>(null)
 const titleId = useId()
 const previousFocus = useRef<HTMLElement | null>(null)
 useEffect(() => {
  previousFocus.current = document.activeElement as HTMLElement | null
  const panel = dialog.current
  panel?.showModal()
  panel?.querySelector('button')?.focus()
  return () => { panel?.close(); previousFocus.current?.focus({ preventScroll: true }) }
 }, [])
 return <dialog ref={dialog} className="metadata-search-progress" aria-labelledby={titleId}
  onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel() } }}
  onCancel={event => { event.preventDefault(); onCancel() }}>
  <span className="metadata-search-book"><Icon name="book" size={42} /></span>
  <h2 id={titleId} role="status">正在尋找書籍資料…</h2>
  <Button onClick={onCancel}>取消搜尋</Button>
 </dialog>
}
