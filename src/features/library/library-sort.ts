import { getBookDisplayTitle, type Book, type DictionaryEntry, type ReadingCycle, type ReadingRecord, type SourceReadingDay } from '../../domain'
import { qualifiedSourceBookIds } from './source-reading-scope'

export const librarySortLabels = {
  existing: '最近更新（預設）', addedDesc: '最近加入', addedAsc: '最早加入',
  title: '書名順序', author: '作者順序', lastRead: '最近閱讀', completed: '最近完讀',
  ratingDesc: '評分由高到低', ratingAsc: '評分由低到高',
} as const
export type LibrarySort = keyof typeof librarySortLabels

const collator = new Intl.Collator('zh-Hant-TW', { numeric: true, sensitivity: 'base' })
const day = (value: string) => value.length === 10 ? value : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))

/** Sort a copy, placing absent scores/dates/authors last. Reading dates never use metadata timestamps. */
export function sortLibrary(books: readonly Book[], order: LibrarySort, dictionaries: readonly DictionaryEntry[], cycles: readonly ReadingCycle[], records: readonly ReadingRecord[], sourceDays: readonly SourceReadingDay[]): Book[] {
  if (order === 'existing') return [...books] // BookService supplies updatedAt descending; preserve equal-time order.
  const authors = new Map(dictionaries.filter(entry => entry.kind === 'author').map(entry => [entry.id, entry.name]))
  const dates = new Map<string, string>()
  const remember = (id: string, value: string | null | undefined) => {
    if (value) { const date = day(value); if (date > (dates.get(id) ?? '')) dates.set(id, date) }
  }
  if (order === 'lastRead' || order === 'completed') {
    for (const cycle of cycles) {
      if (order === 'lastRead' && cycle.status !== 'planned') {
        for (const value of [cycle.startedAt, cycle.startedOn, cycle.lastReadOn]) remember(cycle.bookId, value)
      }
      if (order === 'lastRead' || cycle.status === 'completed') {
        remember(cycle.bookId, cycle.finishedAt); remember(cycle.bookId, cycle.completionDate?.completedOn)
      }
    }
    if (order === 'lastRead') for (const record of records) remember(record.bookId, record.startedAt)
    const qualified = qualifiedSourceBookIds(sourceDays, cycles, records)
    for (const row of sourceDays) if (row.bookId && qualified.has(row.bookId) && (order === 'lastRead' || row.progressPercent === 100 && !row.completionDisputed)) remember(row.bookId, row.date)
  }
  const key = (book: Book): string | number | null => {
    if (order === 'addedAsc' || order === 'addedDesc') return book.createdAt
    if (order === 'title') return getBookDisplayTitle(book)
    if (order === 'author') return book.authorIds.map(id => authors.get(id)).filter(Boolean).join('、') || null
    if (order === 'ratingAsc' || order === 'ratingDesc') return book.rating ? book.rating.value / book.rating.scale : null
    return dates.get(book.id) ?? null
  }
  const descending = ['addedDesc', 'ratingDesc', 'lastRead', 'completed'].includes(order)
  return [...books].sort((a, b) => {
    const x = key(a), y = key(b)
    if (x == null || y == null) return x == null ? y == null ? 0 : 1 : -1
    const compared = typeof x === 'number' && typeof y === 'number' ? x - y : collator.compare(String(x), String(y))
    return descending ? -compared : compared
  })
}
