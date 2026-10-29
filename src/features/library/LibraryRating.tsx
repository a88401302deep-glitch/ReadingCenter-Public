import { useRef, useState } from 'react'
import type { Book } from '../../domain'

export function LibraryRating({ book, onRate }: { book: Book; onRate?: (book: Book, stars: number) => Promise<void> }) {
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const stars = book.rating ? book.rating.value * 5 / book.rating.scale : 0
  const rate = async (value: number) => {
    if (!onRate || lock.current) return
    lock.current = true; setPending(true); setError(''); setMessage('')
    try { await onRate(book, value); setMessage(`已儲存 ${value} 星`) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '評分未儲存，請再試一次') }
    finally { lock.current = false; setPending(false) }
  }
  return <div className="shelf-rating">
    <div role="group" aria-label={`《${book.preferredTitle || book.title}》評分：${stars ? `${stars} 星` : '尚未評分'}`} className="shelf-rating-stars" aria-busy={pending}>
      {[1, 2, 3, 4, 5].map(value => <button key={value} type="button" aria-label={`評為 ${value} 星`} aria-pressed={stars === value} disabled={!onRate || pending} onClick={() => void rate(value)}>
        <span className="rating-star-glyph" aria-hidden="true"><span className="rating-star-base">★</span><span className="rating-star-fill" style={{ width: `${Math.min(1, Math.max(0, stars - value + 1)) * 100}%` }}>★</span></span>
      </button>)}
    </div>
    {message && <span className="sr-only" role="status">{message}</span>}
    {error && <span className="shelf-rating-error" role="alert">{error}</span>}
  </div>
}
