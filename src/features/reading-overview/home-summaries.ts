import type { Book, DictionaryEntry, ReadingContent, ReadingCycle, SourceReadingDay } from '../../domain'

export interface SummaryBook { book: Book; date: string | null }
export interface SummaryNote extends SummaryBook { content: ReadingContent; dateLabel: string }
export interface SummaryCategory extends SummaryBook { categories: { id: string; name: string }[] }
export interface HomeSummaries { completed: SummaryBook[]; highRated: SummaryBook[]; notes: SummaryNote[]; categories: SummaryCategory[] }

export function completionEvidence(cycle: ReadingCycle): string | null {
  const date = cycle.completionDate
  if (date?.precision === 'minute') return new Date(Date.parse(`${date.completedOn}T${date.localTime}:00Z`) - date.offsetMinutes * 60_000).toISOString()
  return date?.completedOn ?? cycle.finishedAt
}

/** No import/edit timestamp is used as historical reading evidence. */
export function buildHomeSummaries(books: Book[], cycles: ReadingCycle[], contents: ReadingContent[], dictionaries: DictionaryEntry[], recent: { book: Book; lastReadAt: string }[], compare: (a: string, b: string) => number, sourceCompleted: SourceReadingDay[] = []): HomeSummaries {
  const bookMap = new Map(books.map(book => [book.id, book]))
  const sort = (a: SummaryBook, b: SummaryBook) => a.date && b.date ? compare(a.date, b.date) || a.book.id.localeCompare(b.book.id) : a.date ? -1 : b.date ? 1 : a.book.id.localeCompare(b.book.id)
  const completedMap = new Map<string, SummaryBook>()
  for (const cycle of cycles) {
    const book = bookMap.get(cycle.bookId)
    if (!book || cycle.status !== 'completed') continue
    const item = { book, date: completionEvidence(cycle) }
    const previous = completedMap.get(book.id)
    if (!previous || sort(item, previous) < 0) completedMap.set(book.id, item)
  }
  for (const row of sourceCompleted) {
    const book = row.bookId ? bookMap.get(row.bookId) : undefined
    if (book && !completedMap.has(book.id)) completedMap.set(book.id, { book, date: row.date })
  }
  const readDates = new Map(recent.map(item => [item.book.id, item.lastReadAt]))
  const highRated = books.filter(book => book.rating && book.rating.value / book.rating.scale >= 0.8 && (readDates.has(book.id) || completedMap.has(book.id)))
    .map(book => ({ book, date: readDates.get(book.id) ?? null })).sort(sort).slice(0, 100)
  const notes: SummaryNote[] = []
  for (const content of contents) {
    const book = bookMap.get(content.bookId)
    if (!book || content.type === 'highlight' || !content.text.trim()) continue
    let date = content.recordedForAt
    let dateLabel = '心得日期'
    if (!date && content.provenance.kind !== 'import') { date = content.createdAt; dateLabel = '新增時間' }
    if (!date && content.type === 'shortReview' && content.provenance.kind === 'import' && content.provenance.sourceId === 'notion-csv-snapshot') {
      const bookCycles = cycles.filter(cycle => cycle.bookId === book.id)
      const sourceId = content.provenance.sourceId
      const sourceRow = content.provenance.externalId.replace(/:short-review$/, '')
      const sourceCycles = bookCycles.filter(cycle => cycle.provenance.kind === 'import' && cycle.provenance.sourceId === sourceId && cycle.provenance.externalId === sourceRow)
      const cycle = content.cycleId ? bookCycles.find(item => item.id === content.cycleId) : sourceCycles.length === 1 ? sourceCycles[0] : sourceCycles.length === 0 && bookCycles.length === 1 ? bookCycles[0] : undefined
      if (cycle?.status === 'completed') { date = completionEvidence(cycle); dateLabel = cycle.completionDate?.precision === 'range' ? '完讀區間末日' : '完讀日' }
    }
    notes.push({ book, content, date, dateLabel: date ? dateLabel : '日期未確定' })
  }
  const categoryNames = new Map(dictionaries.filter(item => item.kind === 'category').map(item => [item.id, item.name]))
  const categoryMap = new Map<string, SummaryBook & { category: string; categoryId: string }>()
  for (const item of recent) for (const categoryId of item.book.categoryIds.length ? item.book.categoryIds : ['uncategorized']) {
    const category = categoryId === 'uncategorized' ? '未分類' : categoryNames.get(categoryId) ?? '分類名稱未設定'
    const candidate = { book: item.book, date: item.lastReadAt, category, categoryId }
    const previous = categoryMap.get(categoryId)
    if (!previous || sort(candidate, previous) < 0) categoryMap.set(categoryId, candidate)
  }
  // Select the latest book in each category first, then merge category winners by book.
  const categoryBooks = new Map<string, SummaryCategory>()
  for (const item of categoryMap.values()) {
    const existing = categoryBooks.get(item.book.id)
    const category = { id: item.categoryId, name: item.category }
    if (existing) existing.categories.push(category)
    else categoryBooks.set(item.book.id, { book: item.book, date: item.date, categories: [category] })
  }
  return { completed: [...completedMap.values()].sort(sort).slice(0, 100), highRated, notes: notes.sort((a, b) => sort(a, b) || a.content.id.localeCompare(b.content.id)).slice(0, 100), categories: [...categoryBooks.values()].sort(sort).slice(0, 100) }
}

