import { useState, type CSSProperties } from 'react'

interface BookCoverProps {
  accent?: string
  alt?: string
  src?: string | null
  title: string
}

export function BookCover({ accent, alt = '', src, title }: BookCoverProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  if (src && src !== failedSrc) {
    return <img alt={alt || `${title}封面`} className="book-cover" src={src} onError={() => setFailedSrc(src)} />
  }

  return (
    <div
      aria-label={`${title}無封面`}
      className="book-cover book-cover--fallback"
      role="img"
      style={accent ? { '--cover-accent': accent } as CSSProperties : undefined}
    >
      <span className="text-cover-rule" aria-hidden="true" />
      <span className="text-cover-title">{title}</span>
      <small aria-hidden="true">READING JOURNAL</small>
    </div>
  )
}
