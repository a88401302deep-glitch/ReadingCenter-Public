import type { Book, DictionaryEntry, ReadingCycle, ReadingProgress, ReadingRecord, SourceReadingDay } from '../../domain'
import { getBookDisplayTitle } from '../../domain'
import { qualifiedSourceBookIds } from './source-reading-scope'
import { isWaitingBook } from './library-reading-scope'

export type LibraryReadingStatus = 'planned' | 'reading' | 'completed' | 'paused' | 'abandoned' | 'unknown'
export const readingStatusLabels: Record<LibraryReadingStatus, string> = { planned: '待讀', reading: '閱讀中', completed: '已完讀', paused: '暫停', abandoned: '棄讀', unknown: '未設定' }
export const bookTypeLabels = { novel: '小說', manga: '漫畫', magazine: '雜誌', webNovel: '網文' } as const
export type LibraryBookType = keyof typeof bookTypeLabels
export interface LibraryBookReading { status: LibraryReadingStatus; progress: ReadingProgress | null }

/** Only explicit type evidence is used; ebook/print are formats, not work types. */
export function libraryBookType(book: Book, dictionaries: readonly DictionaryEntry[]): LibraryBookType | null {
  if (book.bookForm && book.bookForm !== 'other') return book.bookForm
  if (book.publicationKind === 'webSerial' || book.publicationKind === 'webTranslation') return 'webNovel'
  const legacy = dictionaries.find(entry => entry.id === book.mediaTypeId && entry.kind === 'mediaType')?.name ?? book.mediaTypeId
  return ({ novel: 'novel', manga: 'manga', magazine: 'magazine', webnovel: 'webNovel', 小說: 'novel', 漫畫: 'manga', 雜誌: 'magazine', 網路小說: 'webNovel', 網文: 'webNovel' } as Record<string, LibraryBookType>)[legacy] ?? null
}

/** Derived from existing records. No status or progress is written by opening the shelf. */
export function libraryBookReadings(books: readonly Book[], cycles: readonly ReadingCycle[], records: readonly ReadingRecord[], sourceDays: readonly SourceReadingDay[]): Map<string, LibraryBookReading> {
  const qualified = qualifiedSourceBookIds(sourceDays, cycles, records)
  const result = new Map<string, LibraryBookReading>()
  for (const book of books) {
    const relatedCycles = cycles.filter(row => row.bookId === book.id).sort((a, b) => b.sequence - a.sequence)
    const relatedRecords = records.filter(row => row.bookId === book.id)
    const rows = qualified.has(book.id) ? sourceDays.filter(row => row.bookId === book.id) : []
    const cycle = relatedCycles[0]
    const sourceComplete = rows.some(row => row.progressPercent === 100 && !row.completionDisputed)
    const status: LibraryReadingStatus = cycle ? cycle.status
      : sourceComplete ? 'completed' : relatedRecords.length || rows.length ? 'reading'
      : isWaitingBook(book, relatedCycles, relatedRecords, sourceDays.filter(row => row.bookId === book.id)) ? 'planned' : 'unknown'
    const evidence = [
      ...relatedRecords.filter(row => row.progress !== null).map(row => ({ date: row.startedAt, progress: row.progress! })),
      ...rows.map(row => ({ date: row.date, progress: { unit: 'percent' as const, value: row.progressPercent } })),
    ].sort((a, b) => b.date.localeCompare(a.date) || b.progress.value - a.progress.value)
    result.set(book.id, { status, progress: evidence[0]?.progress ?? null })
  }
  return result
}

export function missingBookFields(book: Book, dictionaries: readonly DictionaryEntry[], status: LibraryReadingStatus): string[] {
  const named = (id: string | null, kind: DictionaryEntry['kind']) => Boolean(id && dictionaries.some(entry => entry.id === id && entry.kind === kind && entry.name.trim()))
  const missing: string[] = []
  if (!getBookDisplayTitle(book).trim() || /^未命名（Notion 來源第/.test(getBookDisplayTitle(book))) missing.push('書名')
  if (!book.authorIds.some(id => named(id, 'author'))) missing.push('作者')
  if (!named(book.publisherId, 'publisher')) missing.push('出版社')
  if (!book.cover?.path.trim()) missing.push('封面')
  if (!book.categoryIds.some(id => named(id, 'category'))) missing.push('分類')
  if (status === 'unknown') missing.push('閱讀狀態')
  if (!libraryBookType(book, dictionaries)) missing.push('類型')
  return missing
}

