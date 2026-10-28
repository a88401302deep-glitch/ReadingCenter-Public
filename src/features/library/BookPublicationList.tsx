import { CREATOR_ROLE_LABELS, type Book, type BookCollection, type DictionaryEntry } from '../../domain'
import { Icon } from '../../shared/ui/Icon'

export function BookPublicationList({ book, dictionaries, collections, mediaTypeName }: { book: Book; dictionaries: DictionaryEntry[]; collections: BookCollection[]; mediaTypeName: string }) {
  const name = (id: string) => {
    const entry = dictionaries.find(item => item.id === id)
    if (!entry) return '資料待載入'
    return entry.kind === 'author' && entry.aliases.length ? `${entry.name}（亦名：${entry.aliases.join('、')}）` : entry.name
  }
  const creators = (role: 'author' | 'translator' | 'illustration') => {
    const ids = book.creatorCredits?.filter(credit => credit.role === role).map(credit => credit.creatorId)
    return (ids?.length ? ids : role === 'author' ? book.authorIds : []).map(name).join('、')
  }
  const rows: [string, string | null | undefined][] = [
    ['作者', creators('author')], ['譯者', creators('translator')], ['繪者', creators('illustration')],
    ...(book.creatorCredits ?? []).filter(credit => !['author', 'translator', 'illustration'].includes(credit.role)).map(credit => [CREATOR_ROLE_LABELS[credit.role], name(credit.creatorId)] as [string, string]),
    ['原文書名', book.originalTitle], ['作者原名', book.authorOriginalNames?.join('、')],
    ['出版社', book.publisherId ? name(book.publisherId) : null], ['ISBN', book.isbn],
    ['出版日期', book.publishedOn], ['書籍版本', mediaTypeName],
    ['圖書分類', book.categoryIds.map(name).join('、')],
    ['書籍字數', book.wordCount == null ? null : `${book.wordCount.toLocaleString('zh-TW')} 字`],
    ['系列', book.collectionId ? collections.find(item => item.id === book.collectionId)?.name ?? '資料待載入' : null],
    ['卷次／集數', book.sequence?.label],
  ]
  return <dl className="book-publication-list" aria-label="書籍資料列表">
    {rows.map(([label, value], index) => <div className="book-publication-row" key={`${label}-${index}`}>
      <dt>{label}</dt><dd>{value?.trim() || <span className="book-field-pending" role="img" aria-label={`${label}待編輯`} title={`${label}待編輯`}><Icon name="editNote" /></span>}</dd>
    </div>)}
  </dl>
}
