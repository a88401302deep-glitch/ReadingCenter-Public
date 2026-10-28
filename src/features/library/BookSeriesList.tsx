import { getBookDisplayTitle, type Book, type BookCollection } from '../../domain'
import { bookFormName, seriesBooks } from '../books/book-series'

export function BookSeriesList({ book, books, collections }: { book: Book; books: Book[]; collections: BookCollection[] }) {
  if (!book.collectionId) return null
  const collection = collections.find(item => item.id === book.collectionId && item.kind === 'series')
  if (!collection) return <p>系列資料未載入</p>
  const members = seriesBooks(books, collection.id)
  return <section className="book-series-list" aria-label="同系列書籍">
    <h4>系列：{collection.name} · 同系列書籍（{members.length} 本）</h4>
    <ul>{members.map(member => <li key={member.id} aria-current={member.id === book.id ? 'true' : undefined}>
      {bookFormName(member)}｜{member.sequence?.label || '卷次未設定'}｜{getBookDisplayTitle(member)}
      {member.languageTag !== 'und' && ` · ${member.languageTag}`}{member.isbn && ` · ISBN ${member.isbn}`}
    </li>)}</ul>
  </section>
}
