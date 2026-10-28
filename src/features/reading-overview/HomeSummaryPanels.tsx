import { Icon } from "../../shared/ui/Icon"
import { useState } from 'react'
import { CoverPreview } from '../../shared/ui/CoverPreview'
import { BookCover } from '../../shared/ui'
import { getBookDisplayTitle, type Book } from '../../domain'
import type { HomeSummaries } from './home-summaries'
const formatDate = (date: string) => new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeZone: 'Asia/Taipei' }).format(new Date(date))
export function HomeSummaryPanels({ summaries, onOpenBook }: { summaries: HomeSummaries; onOpenBook: (book: Book) => void }) {
 const [previewBook, setPreviewBook] = useState<Book | null>(null)
 const seen = new Set<string>()
 const notes = summaries.notes.filter(item => { if (seen.has(item.book.id)) return false; seen.add(item.book.id); return true }).slice(0, 6)
 return <div className="journal-summaries" aria-label="閱讀摘要">
  {previewBook && <CoverPreview book={previewBook} onClose={() => setPreviewBook(null)} />}
  <section aria-label="最近讀完"><div className="journal-heading"><h2>最近讀完</h2><span aria-hidden="true">FINISHED</span></div><ol className="finished-cards">{summaries.completed.slice(0, 6).map(item => <li className="journal-book-card is-completed" key={item.book.id}><button type="button" aria-label={`放大《${getBookDisplayTitle(item.book)}》封面`} onClick={() => setPreviewBook(item.book)}><BookCover src={item.book.cover?.path} title={getBookDisplayTitle(item.book)} /></button></li>)}</ol>{!summaries.completed.length && <p className="empty-line">尚無完讀書籍</p>}</section>
  <section aria-label="閱讀心得"><div className="journal-heading review-heading"><Icon name="list" size={22} /><h2>閱讀心得</h2><span aria-hidden="true">BOOK NOTES</span></div><ol className="home-review-cards">{notes.map(item => <li key={item.book.id}><button className="review-card" type="button" onClick={() => onOpenBook(item.book)}><BookCover src={item.book.cover?.path} title={getBookDisplayTitle(item.book)} /><div><strong>{getBookDisplayTitle(item.book)}</strong><p>{item.content.text}</p>{item.date && <time dateTime={item.date}>{formatDate(item.date)}</time>}</div></button></li>)}</ol>{!notes.length && <p className="empty-line">把讀後的想法留在這裡。</p>}</section>
 </div>
}
