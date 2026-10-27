import { useEffect, useRef } from 'react'
import type { Book } from '../../domain'
import { getBookDisplayTitle } from '../../domain'
import { BookCover } from './BookCover'

/** Cover-only viewer: a second tap closes it without navigating or changing data. */
export function CoverPreview({ book, onClose }: { book: Book; onClose: () => void }) {
 const dialog = useRef<HTMLDialogElement>(null)
 const title = getBookDisplayTitle(book)
 useEffect(() => {
  const panel = dialog.current
  const previousFocus = document.activeElement as HTMLElement | null
  const previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  panel?.showModal()
  return () => {
   panel?.close()
   document.body.style.overflow = previousOverflow
   previousFocus?.focus({ preventScroll: true })
  }
 }, [])
 return <dialog ref={dialog} className="cover-preview" aria-label={`《${title}》封面預覽`}
  onCancel={event => { event.preventDefault(); onClose() }}
  onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() } }}>
  <button className="cover-preview-surface" type="button" aria-label="關閉封面預覽" onClick={onClose}>
   <BookCover src={book.cover?.path} title={title} />
  </button>
 </dialog>
}
