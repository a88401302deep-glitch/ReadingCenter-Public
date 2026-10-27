import { CREATOR_ROLE_LABELS, type Book, type DictionaryEntry } from '../../domain'

export function BookCreators({ book, dictionaries }: { book: Book; dictionaries: DictionaryEntry[] }) {
  const entries = new Map(dictionaries.map((entry) => [entry.id, entry]))
  const name = (id: string) => {
    const entry = entries.get(id)
    if (!entry) return '創作者資料未載入'
    return `${entry.name}${entry.kind === 'author' && entry.aliases.length ? `（亦名：${entry.aliases.join('、')}）` : ''}`
  }
  if (book.creatorCredits?.length) return <>{book.creatorCredits.map((credit) => <p key={`${credit.creatorId}:${credit.role}`}>{CREATOR_ROLE_LABELS[credit.role]}｜{name(credit.creatorId)}</p>)}</>
  return <p>{book.authorIds.length ? book.authorIds.map(name).join('、') : '作者未設定'}</p>
}
