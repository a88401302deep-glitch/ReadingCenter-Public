import { useRef, useState } from 'react'
import type { Book } from '../../domain'
import { Modal } from '../../shared/ui'

function RatingStar() {
  return <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" focusable="false" aria-hidden="true"><path d="m12 2.8 2.8 5.7 6.3.9-4.55 4.44 1.08 6.26L12 17.14l-5.63 2.96 1.08-6.26L2.9 9.4l6.3-.9L12 2.8Z" /></svg>
}

export function LibraryRating({ book, onRate }: { book: Book; onRate?: (book: Book, stars: number) => Promise<void> }) {
  const lock = useRef(false)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const stars = book.rating ? book.rating.value * 5 / book.rating.scale : 0
  const rate = async (value: number) => {
    if (!onRate || lock.current) return
    lock.current = true; setPending(true); setError(''); setMessage('')
    try { await onRate(book, value); setMessage(`已儲存 ${value} 星`); setOpen(false) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '評分未儲存，請再試一次') }
    finally { lock.current = false; setPending(false) }
  }
  const title = book.preferredTitle || book.title
  return <div className="shelf-rating">
    <div role="group" aria-label={`《${title}》評分：${stars ? `${stars} 星` : '尚未評分'}`}>
      <button className={`shelf-rating-badge${stars ? ' is-rated' : ''}`} type="button" aria-label={`《${title}》${stars ? `${stars} 星，修改評分` : '待評分'}`} aria-haspopup="dialog" disabled={!onRate || pending} onClick={() => { setError(''); setOpen(true) }}>
        {stars > 0 && <span>{Number(stars.toFixed(2))}</span>}<RatingStar />
      </button>
    </div>
    <Modal open={open} title={`《${title}》評分`} trapFocus onClose={() => { if (!lock.current) setOpen(false) }}>
      <div className="shelf-rating-picker" aria-busy={pending}>
        <p>選擇星等</p>
        <div className="shelf-rating-options" role="group" aria-label="選擇評分">
          {Array.from({ length: 10 }, (_, index) => (index + 1) / 2).map(value => <button key={value} type="button" aria-label={`評為 ${value} 星`} aria-pressed={stars === value} disabled={pending} onClick={() => void rate(value)}>{value}<RatingStar /></button>)}
        </div>
        {error && <p className="shelf-rating-error" role="alert">{error}</p>}
      </div>
    </Modal>
    {message && <span className="sr-only" role="status">{message}</span>}
  </div>
}
