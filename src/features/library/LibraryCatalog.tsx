import { createPortal } from 'react-dom'
import { librarySortLabels, sortLibrary, type LibrarySort } from './library-sort'
import { JournalEmptyState } from '../../shared/ui/JournalEmptyState'
import { useId, useMemo, useRef, useState } from 'react'
import { getBookDisplayTitle, type Book, type DictionaryEntry, type ReadingCycle, type ReadingRecord, type SourceReadingDay } from '../../domain'
import { BookCover, Button, FormMessage, Icon } from '../../shared/ui'
import { dictionaryOptions, emptyLibraryFilters, filterLibrary } from './library-query'
import { libraryBookReadings, missingBookFields, readingStatusLabels, type LibraryReadingStatus } from './library-book-summary'
import { libraryBookType, bookTypeLabels } from './library-book-summary'
import { BookProgress } from '../../shared/ui/BookProgress'
import { LibraryRating } from './LibraryRating'

interface LibraryCatalogProps {
  toolbarHost?: HTMLElement | null
  onRate?: (book: Book, stars: number) => Promise<void>
  books: Book[]
  dictionaries: DictionaryEntry[]
  cycles?: ReadingCycle[]
  records?: ReadingRecord[]
  sourceDays?: SourceReadingDay[]
  readingLoaded?: boolean
  loadError?: string | null
  onOpen: (book: Book) => void
}

export function LibraryCatalog({ toolbarHost, books, dictionaries, cycles = [], records = [], sourceDays = [], readingLoaded = true, loadError, onOpen, onRate }: LibraryCatalogProps) {
  const [order, setOrder] = useState<LibrarySort>('existing')
  const [ratingFilter, setRatingFilter] = useState('')
  const [page, setPage] = useState(1)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [layout, setLayout] = useState<'covers' | 'list'>('covers')
  const panelId = useId()
  const filterTrigger = useRef<HTMLButtonElement>(null)
  const authorNames = useMemo(() => new Map(dictionaries.filter(entry => entry.kind === 'author').map(entry => [entry.id, entry.name])), [dictionaries])
  const [bookType, setBookType] = useState('')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState(emptyLibraryFilters)
  const [status, setStatus] = useState<LibraryReadingStatus | ''>('')
  const [completeness, setCompleteness] = useState('')

  const readings = useMemo(() => libraryBookReadings(books, cycles, records, sourceDays), [books, cycles, records, sourceDays])
  const missing = useMemo(() => new Map(books.map(book => [book.id, missingBookFields(book, dictionaries, readings.get(book.id)!.status)])), [books, dictionaries, readings])
  const results = useMemo(() => sortLibrary(filterLibrary(books, dictionaries, query, filters).filter(book => {
    const fields = missing.get(book.id)!
    return (!ratingFilter || (ratingFilter === 'rated' ? Boolean(book.rating) : !book.rating && readings.get(book.id)?.status === 'completed')) && (!bookType || libraryBookType(book, dictionaries) === bookType) && (!status || readings.get(book.id)?.status === status)
      && (!completeness || (completeness === 'complete' ? fields.length === 0 : completeness === 'incomplete' ? fields.length > 0 : fields.includes(completeness)))
  }), order, dictionaries, cycles, records, sourceDays), [books, dictionaries, query, filters, status, completeness, missing, readings, bookType, order, ratingFilter, cycles, records, sourceDays])
  const pageCount = Math.max(1, Math.ceil(results.length / 30))
  const currentPage = Math.min(page, pageCount)
  const changePage = (value: number) => { setPage(value); requestAnimationFrame(() => document.getElementById('library-books')?.scrollIntoView?.({ block: 'start' })) }
  const pagination = <nav className="library-pagination" aria-label="書庫分頁"><Button disabled={currentPage === 1} onClick={() => changePage(currentPage - 1)}>上一頁</Button><label>第 <select aria-label="選擇書庫頁碼" value={currentPage} onChange={event => changePage(Number(event.target.value))}>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> ／ {pageCount} 頁</label><Button disabled={currentPage === pageCount} onClick={() => changePage(currentPage + 1)}>下一頁</Button></nav>
  const hasConditions = Boolean(bookType || query || filters.categoryId || filters.tagId || filters.sourceId || status || completeness || ratingFilter || order !== 'existing')
  const categories = dictionaryOptions(dictionaries, 'category')
  const tags = dictionaryOptions(dictionaries, 'tag')
  const sources = dictionaryOptions(dictionaries, 'source')
  const setFilter = (key: keyof typeof filters, value: string) => { setPage(1); setFilters(current => ({ ...current, [key]: value })) }

  const toolbar = <div className="library-tools">
      <label className="search-field"><Icon name="search" size={17} /><span className="sr-only">搜尋書庫</span><input aria-label="搜尋書庫" placeholder="搜尋書名、作者" type="search" value={query} onChange={event => { setPage(1); setQuery(event.target.value) }} /></label>
      <button ref={filterTrigger} className="library-filter-trigger" type="button" aria-label="書庫篩選" title={filtersOpen ? '收起篩選' : '展開篩選'} aria-expanded={filtersOpen} aria-controls={panelId} onClick={() => setFiltersOpen(open => !open)}><Icon name="filter" size={21} />{hasConditions && <i aria-hidden="true" />}{hasConditions && <span className="sr-only">條件已啟用</span>}</button>
      <div id={panelId} hidden={!filtersOpen} className="library-filter-panel" role="group" aria-label="書庫篩選選項" onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); setFiltersOpen(false); filterTrigger.current?.focus({ preventScroll: true }) }
      }}>
        <div className="library-layout-switch" role="group" aria-label="書庫顯示方式"><button type="button" aria-pressed={layout === 'covers'} onClick={() => setLayout('covers')}><Icon name="grid" size={16} />封面模式</button><button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')}><Icon name="list" size={16} />清單模式</button></div>
        <div className="library-type-chips" role="group" aria-label="依類型篩選">{[['', '全部類型'], ...Object.entries(bookTypeLabels)].map(([value, label]) => <button type="button" aria-pressed={bookType === value} key={value} onClick={() => { setBookType(value); setPage(1) }}>{label}</button>)}</div>
        <div className="library-filters">
          <label>排序<select aria-label="書庫排序" value={order} onChange={event => { setPage(1); setOrder(event.target.value as LibrarySort) }}>{Object.entries(librarySortLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>評分篩選<select aria-label="依評分篩選" value={ratingFilter} onChange={event => { setPage(1); setRatingFilter(event.target.value) }}><option value="">全部</option><option value="rated">已評分</option><option value="unratedCompleted">已完讀待評分</option></select></label>
          <label>閱讀狀態<select aria-label="依閱讀狀態篩選" value={status} onChange={event => { setPage(1); setStatus(event.target.value as LibraryReadingStatus | '') }}><option value="">全部</option>{Object.entries(readingStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>資料完整度<select aria-label="依資料完整度篩選" value={completeness} onChange={event => { setPage(1); setCompleteness(event.target.value) }}><option value="">全部</option><option value="incomplete">資料待補</option><option value="complete">資料完整</option>{['書名', '作者', '出版社', '封面', '分類', '閱讀狀態', '類型'].map(field => <option key={field} value={field}>缺{field}</option>)}</select></label>
          <label>分類<select aria-label="依分類篩選" value={filters.categoryId} onChange={event => setFilter('categoryId', event.target.value)}><option value="">全部</option>{categories.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>標籤<select aria-label="依標籤篩選" value={filters.tagId} onChange={event => setFilter('tagId', event.target.value)}><option value="">全部</option>{tags.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
          <label>來源<select aria-label="依來源篩選" value={filters.sourceId} onChange={event => setFilter('sourceId', event.target.value)}><option value="">全部</option>{sources.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        </div>
        {hasConditions && <Button size="small" variant="ghost" onClick={() => { setPage(1); setBookType(''); setQuery(''); setFilters(emptyLibraryFilters); setStatus(''); setCompleteness(''); setRatingFilter(''); setOrder('existing') }}>清除條件</Button>}
      </div>
    </div>

  if (!readingLoaded && !loadError) return <JournalEmptyState busy title="正在載入書庫與閱讀狀態…" />
  if (loadError) return <FormMessage tone="error">{loadError}</FormMessage>
  return <section className="content-section cover-library" aria-label="書庫">
    {toolbarHost ? createPortal(toolbar, toolbarHost) : toolbar}
    {filtersOpen && <p className="library-result-count" role="status" aria-label="書庫符合筆數">{results.length}／{books.length} 本</p>}
    {results.length > 30 && pagination}
    {books.length === 0 ? <JournalEmptyState title="書庫目前是空的" /> : results.length === 0 ? <JournalEmptyState title="沒有符合條件的書籍" detail="換個關鍵字，或清除篩選再看看。" /> : <div id="library-books" className={`book-list book-list--${layout} library-books-anchor`}>{results.slice((currentPage - 1) * 30, currentPage * 30).map(book => {
      const title = getBookDisplayTitle(book), reading = readings.get(book.id)!
      const authors = book.authorIds.map(id => authorNames.get(id) || '作者資料未載入').join('、') || '作者未設定'
      return <article className={`book-row journal-book-card is-${reading.status}`} key={book.id}>
        {layout === 'covers' ? <>
          <button className="book-row-cover book-cover-open" type="button" aria-label={`開啟《${title}》`} aria-describedby={`${panelId}-status-${book.id}`} title={`${title}｜${readingStatusLabels[reading.status]}`} onClick={() => onOpen(book)}><BookCover src={book.cover?.path} title={title} /></button>
          <h3 className="sr-only">{title}</h3><span className="sr-only" id={`${panelId}-status-${book.id}`}>{readingStatusLabels[reading.status]}</span>
          {reading.status !== 'completed' && <BookProgress progress={reading.progress} quiet />}
        </> : <button className="library-list-entry" type="button" aria-label={`開啟《${title}》`} aria-describedby={`${panelId}-author-${book.id}`} onClick={() => onOpen(book)}><span className="library-list-title">{title}</span><span className="library-list-authors" id={`${panelId}-author-${book.id}`}>{authors}</span></button>}
        {reading.status === 'completed' && <LibraryRating book={book} onRate={onRate} />}
      </article>
    })}</div>}
    {results.length > 30 && pagination}
  </section>
}
