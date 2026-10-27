import { bookTypeLabels, libraryBookType, missingBookFields, readingStatusLabels, type LibraryReadingStatus } from './library-book-summary'
import { BookSeriesList } from './BookSeriesList'
import { BookCreators } from './BookCreators'
import { getBookLanguageName } from '../../shared/book-language'
import { getBookDisplayTitle, getBookNotes, getBookSourceUrls, type Book, type BookCollection, type DictionaryEntry } from '../../domain'
import { BookCover, Button, Tag } from '../../shared/ui'
import { ImportSourceNotes } from '../books/ImportSourceNotes'
import { BookForm } from '../books/BookForm'
import type { BookDraft } from '../books/book-service'
import { recommendBookTerms } from '../books/book-recommendations'
import { ReadingCycleManager } from '../reading-cycles/ReadingCycleManager'
import type { ReadingCycleService } from '../reading-cycles/reading-cycle-service'
import type { ReadingContentService } from '../reading-contents/reading-content-service'
import type { ReadingRecordService } from '../reading-records/reading-record-service'
import { BookReadingSummary } from '../reading-overview/ReadingDashboard'
import type { ReadingOverviewService } from '../reading-overview/reading-overview-service'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

interface Props {
  book: Book
  onDirtyChange?: (dirty: boolean) => void
  readingStatus?: LibraryReadingStatus
  onDelete?: (book: Book) => void
  onStatusChange?: (status: Exclude<LibraryReadingStatus, 'unknown'>) => Promise<void>
  collections?: BookCollection[]
  books: Book[]
  busy: boolean
  contentService: ReadingContentService
  cycleService: ReadingCycleService
  dictionaries: DictionaryEntry[]
  error: string | null
  onSave: (draft: BookDraft, expectedRevision: number) => Promise<boolean>
  onContentChanged: () => void
  onReadingChanged: () => void
  overviewService: ReadingOverviewService
  readingRevision: number
  syncRevision?: number
  recordService: ReadingRecordService
}

export function BookDetail({ book, onDirtyChange, readingStatus = 'unknown', onStatusChange, onDelete, books, collections = [], busy, contentService, cycleService, dictionaries, error, onContentChanged, onReadingChanged, onSave, overviewService, readingRevision, recordService, syncRevision = 0 }: Props) {
  const viewRef = useRef<HTMLDivElement>(null)
  const returnPoint = useRef<{ panel: HTMLElement | null; top: number; left: number; x: number; y: number; target: HTMLButtonElement } | null>(null)
  const [dirty, setDirty] = useState(false)
  const changeDirty = useCallback((value: boolean) => { setDirty(value); onDirtyChange?.(value) }, [onDirtyChange])
  const [editing, setEditing] = useState<Book | null>(null)
  useLayoutEffect(() => {
    if (editing || !returnPoint.current) return
    const point = returnPoint.current
    returnPoint.current = null
    point.target.focus({ preventScroll: true })
    if (point.panel) { point.panel.scrollTop = point.top; point.panel.scrollLeft = point.left }
    if (window.scrollX !== point.x || window.scrollY !== point.y) window.scrollTo(point.x, point.y)
  }, [editing])
  const openEditor = (target: HTMLButtonElement) => {
    const panel = viewRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null
    returnPoint.current = { panel, top: panel?.scrollTop ?? 0, left: panel?.scrollLeft ?? 0, x: window.scrollX, y: window.scrollY, target }
    setEditing(currentBook)
  }
  const currentBook = books.find((item) => item.id === book.id) ?? book
  const names = new Map(dictionaries.map((entry) => [entry.id, entry.name]))
  const mediaTypeName = names.get(currentBook.mediaTypeId) ?? ({ ebook: '電子書', print: '紙本書', manga: '漫畫' } as Record<string, string>)[currentBook.mediaTypeId] ?? '媒體類型未分類'
  const languageName = getBookLanguageName(currentBook.languageTag)
  const sourceUrls = getBookSourceUrls(currentBook)
  const notes = getBookNotes(currentBook)
  const displayTitle = getBookDisplayTitle(currentBook)
  const type = libraryBookType(currentBook, dictionaries)
  const missing = missingBookFields(currentBook, dictionaries, readingStatus)
  const save = async (draft: BookDraft) => { if (editing && await onSave(draft, editing.revision)) { changeDirty(false); setEditing(null) } }

  return <article className="book-detail">
    {editing && <BookForm books={books}
      book={editing}
      busy={busy}
      dictionaries={dictionaries} collections={collections}
      categoryRecommendations={recommendBookTerms(books, dictionaries, 'category')}
      tagRecommendations={recommendBookTerms(books, dictionaries, 'tag')}
      error={error}
      onDirtyChange={changeDirty}
      onCancel={() => { if (busy || dirty && !window.confirm('尚有未儲存的變更，確定要離開嗎？')) return; changeDirty(false); setEditing(null) }}
      onSubmit={save}
    />}
    <div ref={viewRef} className="book-detail-view" hidden={editing !== null}>
      <section className="book-detail-information" aria-label="書籍資料">
        <div className="book-detail-summary">
          <div className="book-detail-cover"><BookCover src={currentBook.cover?.path} title={displayTitle} /></div>
          <div className="book-detail-metadata">
            <div className="book-detail-title"><h3>{displayTitle}</h3></div>
            <BookCreators book={currentBook} dictionaries={dictionaries} />
            <p>類型｜{type ? bookTypeLabels[type] : '未設定'}</p>
            {onStatusChange ? <label className="book-detail-status">閱讀狀態<select aria-label="書籍閱讀狀態" disabled={busy} value={readingStatus} onChange={event => void onStatusChange(event.target.value as Exclude<LibraryReadingStatus, 'unknown'>)}><option value="unknown" disabled>未設定</option>{Object.entries(readingStatusLabels).filter(([value]) => value !== 'unknown').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <p>閱讀狀態｜{readingStatusLabels[readingStatus]}</p>}
            <Button size="small" disabled={busy} onClick={event => openEditor(event.currentTarget)}>編輯書籍</Button>
            {error && <p role="alert">{error}</p>}
          </div>
        </div>
        <div className="book-detail-terms">
          <div><h4>分類</h4><div className="book-row-tags">{currentBook.categoryIds.length ? currentBook.categoryIds.map(id => <Tag key={id} kind="category">{names.get(id) ?? id}</Tag>) : <span>未設定</span>}</div></div>
          <div><h4>標籤</h4><div className="book-row-tags">{currentBook.tagIds.length ? currentBook.tagIds.map(id => <Tag key={id} kind="tag">{names.get(id) ?? id}</Tag>) : <span>未設定</span>}</div></div>
        </div>
        <BookSeriesList book={currentBook} books={books} collections={collections} />
        <details className="book-detail-publication">
          <summary>出版與來源資料{missing.length > 0 ? ` · 待補 ${missing.length} 項` : ''}</summary>
          <div className="book-detail-publication-body">
            {missing.length > 0 && <p className="book-missing-fields">資料待補：{missing.join('、')}</p>}
            {currentBook.preferredTitle && currentBook.preferredTitle !== currentBook.title && <p>來源書名｜{currentBook.title}</p>}
            {currentBook.originalTitle && <p>原文書名｜{currentBook.originalTitle}</p>}
            {currentBook.authorOriginalNames?.length ? <p>作者原名｜{currentBook.authorOriginalNames.join('、')}</p> : null}
            <p>出版社｜{currentBook.publisherId ? names.get(currentBook.publisherId) ?? '出版社資料未載入' : '未設定'}</p>
            <p>ISBN｜{currentBook.isbn || '未設定'}</p>
            <p>出版日期｜{currentBook.publishedOn || '未設定'}</p>
            <p>{languageName}｜{mediaTypeName}</p>
            <p>書籍字數｜{currentBook.wordCount == null ? '未知' : `${currentBook.wordCount.toLocaleString('zh-TW')} 字`}</p>
            {currentBook.rating && <p>評分｜{currentBook.rating.value}／{currentBook.rating.scale}</p>}
            <div className="book-detail-source-tags"><h4>書籍來源</h4><div className="book-row-tags">{currentBook.sourceIds.length ? currentBook.sourceIds.map(id => <Tag key={id} kind="source">{names.get(id) ?? id}</Tag>) : <span>未設定</span>}</div></div>
            {sourceUrls.map(url => <p key={url}><a href={url} target="_blank" rel="noopener noreferrer">{url}</a></p>)}
            {currentBook.wordCountSourceUrl && <p><a href={currentBook.wordCountSourceUrl} target="_blank" rel="noopener noreferrer">字數來源</a></p>}
            <ImportSourceNotes notes={notes.importSourceNotes} />
          </div>
        </details>
      </section>
    <ReadingCycleManager readingSummary={<BookReadingSummary bookId={book.id} revision={readingRevision} service={overviewService} />} compact revision={syncRevision + readingRevision} bookId={book.id} service={cycleService} recordService={recordService} contentService={contentService} onContentChanged={onContentChanged} onReadingChanged={onReadingChanged} />
    {notes.bookNote && <section className="book-note" aria-label="書籍備註"><h3>書籍備註</h3><p>{notes.bookNote}</p></section>}
    {onDelete && <details className="book-detail-more"><summary>更多操作</summary><Button size="small" variant="danger" onClick={() => onDelete(currentBook)}>刪除書籍</Button></details>}
    </div>
  </article>
}



