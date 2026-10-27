import { getBookNotes, type Book, type ReadingCycle, type ReadingRecord, type SourceReadingDay } from '../../domain'

import { qualifiedSourceBookIds } from './source-reading-scope'

/** Unknown status and any actual reading evidence stay visible in the main catalog. */
export function isWaitingBook(book: Book, cycles: readonly ReadingCycle[], records: readonly ReadingRecord[], sourceDays: readonly SourceReadingDay[] = []): boolean {
  if (records.some(record => record.bookId === book.id)) return false
  const related = cycles.filter(cycle => cycle.bookId === book.id)
  if (related.some(cycle => cycle.status !== 'planned' || cycle.startedAt || cycle.finishedAt || cycle.completionDate || cycle.reportedReadingDays)) return false
  if (sourceDays.some(row => row.bookId === book.id)) return !qualifiedSourceBookIds(sourceDays, cycles, records).has(book.id)
  if (related.length) return true
  if (book.provenance.kind !== 'import' || book.provenance.sourceId !== 'notion-csv-snapshot') return false
  const notes = getBookNotes(book).importSourceNotes
  if (!notes?.startsWith('Notion 歷史搬遷｜原始資料保留\n【來源第 ')) return false
  const blocks = notes.split(/【來源第 \d+ 列】\n/).slice(1)
  return blocks.length > 0 && blocks.every(block => {
    const field = (name: string) => block.match(new RegExp(`(?:^|\\n)${name}：([^\\n]*)`))?.[1].trim()
    return field('閱讀') === '尚未開始' && field('時間') === '' && field('關聯生活點滴') === '' && field('閱讀時間') === '總共閱讀0天' && field('一行心得') === '' && field('讀完') === 'No'
  })
}

