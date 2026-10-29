import { bookTypeLabels, libraryBookType, readingStatusLabels, type LibraryReadingStatus } from './library-book-summary'
import { BookSeriesList } from './BookSeriesList'
import { BookPublicationList } from './BookPublicationList'
import { BookDetailCover } from './BookDetailCover'
import { getBookNotes, getBookSourceUrls, type Book, type BookCollection, type DictionaryEntry } from '../../domain'
import { Button, Icon, Tag, Popover } from '../../shared/ui'
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
import { createPortal } from 'react-dom'

interface Props {
  book: Book
  onCoverPendingChange?: (pending: boolean) => void
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
  onSave: (draft: BookDraft, expectedRevision: number) => Promise<Book | null>
  onContentChanged: () => void
  onReadingChanged: () => void
  overviewService: ReadingOverviewService
  readingRevision: number
  syncRevision?: number
  recordService: ReadingRecordService
}

export function BookDetail({ book, onDirtyChange, onCoverPendingChange, readingStatus = 'unknown', onStatusChange, onDelete, books, collections = [], busy, contentService, cycleService, dictionaries, error, onContentChanged, onReadingChanged, onSave, overviewService, readingRevision, recordService, syncRevision = 0 }: Props) {
  const viewRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDialogElement>(null)
  const returnPoint = useRef<{ panel: HTMLElement | null; top: number; left: number; x: number; y: number; target: HTMLButtonElement } | null>(null)
  const [dirty, setDirty] = useState(false)
  const [coverDirty, setCoverDirty] = useState(false)
  const changeDirty = useCallback((value: boolean) => { setDirty(value); onDirtyChange?.(value || coverDirty) }, [onDirtyChange, coverDirty])
  const [editing, setEditing] = useState<Book | null>(null)
  const editorOpen = editing !== null
  useLayoutEffect(() => {
    if (!editorOpen) return
    const editor = editorRef.current
    const panel = viewRef.current?.closest<HTMLElement>('[role="dialog"]')
    const previousHidden = panel?.getAttribute('aria-hidden') ?? null
    // The editor lives outside the single-book panel so its :has(.book-form) rules cannot resize that panel.
    editor?.showModal()
    panel?.setAttribute('aria-hidden', 'true')
    return () => {
      editor?.close()
      document.body.classList.remove('book-editor-open')
      if (previousHidden === null) panel?.removeAttribute('aria-hidden')
      else panel?.setAttribute('aria-hidden', previousHidden)
    }
  }, [editorOpen])
  useLayoutEffect(() => {
    if (editing || busy || !returnPoint.current) return
    const point = returnPoint.current
    returnPoint.current = null
    const restore = () => {
      point.target.focus({ preventScroll: true })
      if (point.panel) { point.panel.scrollTop = point.top; point.panel.scrollLeft = point.left }
      if (window.scrollX !== point.x || window.scrollY !== point.y) window.scrollTo(point.x, point.y)
    }
    restore()
    // Restore focus after the editor's native top layer and body visibility class have both closed.
    const frame = window.requestAnimationFrame(restore)
    return () => window.cancelAnimationFrame(frame)
  }, [editing, busy])
  const openEditor = (target: HTMLButtonElement) => {
    const panel = viewRef.current?.closest<HTMLElement>('[role="dialog"]') ?? null
    returnPoint.current = { panel, top: panel?.scrollTop ?? 0, left: panel?.scrollLeft ?? 0, x: window.scrollX, y: window.scrollY, target }
    setEditing(currentBook)
  }
  const currentBook = books.find((item) => item.id === book.id) ?? book
  const names = new Map(dictionaries.map((entry) => [entry.id, entry.name]))
  const mediaTypeName = names.get(currentBook.mediaTypeId) ?? ({ ebook: '電子書', print: '紙本書', manga: '漫畫' } as Record<string, string>)[currentBook.mediaTypeId] ?? '媒體類型未分類'
  const sourceUrls = getBookSourceUrls(currentBook)
  const notes = getBookNotes(currentBook)
  const type = libraryBookType(currentBook, dictionaries)
  const save = async (draft: BookDraft) => {
    if (!editing) return
    const updated = await onSave(draft, editing.revision)
    if (!updated) return
    changeDirty(false)
    setEditing(null)
  }

  const cancelEditor = () => { if (busy || dirty && !window.confirm('尚有未儲存的變更，確定要離開嗎？')) return; changeDirty(false); setEditing(null) }

  return <article className="book-detail">
    {editing && createPortal(<dialog ref={editorRef} className="book-detail-editor-dialog" aria-label="編輯書籍"
      onCancel={event => { event.preventDefault(); event.stopPropagation(); cancelEditor() }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelEditor() } if (event.key === 'Tab') event.stopPropagation() }}>
    <BookForm key={editing.revision} expanded inlineMetadataSearch books={books}
      book={editing}
      busy={busy}
      dictionaries={dictionaries} collections={collections}
      categoryRecommendations={recommendBookTerms(books, dictionaries, 'category')}
      tagRecommendations={recommendBookTerms(books, dictionaries, 'tag')}
      error={error}
      onDirtyChange={changeDirty}
      onCancel={cancelEditor}
      onSubmit={save}
    /></dialog>, document.body)}
    <div ref={viewRef} className="book-detail-view">
      <section className="book-detail-book-card" aria-label="書籍總覽"><header className="book-card-heading"><h3><Icon name="book" size={22} />書籍資料</h3><Button variant="edit" size="small" disabled={busy || coverDirty} onClick={event => openEditor(event.currentTarget)}>編輯書籍資料</Button></header>
      <BookDetailCover showActions={false} book={currentBook} author={currentBook.authorIds.map(id => names.get(id)).filter(Boolean).join('、')} busy={busy} onSave={onSave} onPendingChange={onCoverPendingChange} onDirtyChange={value => { setCoverDirty(value); onDirtyChange?.(value || dirty) }} />
      <div className="book-detail-sidebar">
      <section className="book-detail-information book-detail-panel" aria-label="書籍資料">
        <div className="book-detail-panel-heading"><h3><Icon name="book" />書籍資訊</h3></div>
        {error && <p role="alert">{error}</p>}
        <BookPublicationList showSparseHint hideEmpty showMissingIcons={false} book={currentBook} dictionaries={dictionaries} collections={collections} mediaTypeName={mediaTypeName} />
        <BookSeriesList book={currentBook} books={books} collections={collections} />
        {notes.bookNote && <div className="book-note"><h4>書籍備註</h4><p>{notes.bookNote}</p></div>}
      </section>
      {(type || currentBook.sourceIds.length > 0 || currentBook.tagIds.length > 0 || currentBook.rating || sourceUrls.length > 0) && <section className="book-detail-personal book-detail-panel" aria-label="我的分類與標籤">
        <div className="book-detail-panel-heading"><h3><Icon name="library" />我的分類與標籤</h3></div>
        {(type) && <p>書籍類型｜{type ? bookTypeLabels[type] : currentBook.bookForm === 'other' ? '一般書籍' : '未設定'}</p>}
        {(currentBook.sourceIds.length > 0) && <div className="book-detail-source-tags"><h4>書籍來源</h4><div className="book-row-tags">{currentBook.sourceIds.length ? currentBook.sourceIds.map(id => <Tag key={id} kind="source">{names.get(id) ?? '未設定'}</Tag>) : <span>未設定</span>}</div></div>}
        {(currentBook.tagIds.length > 0) && <div><h4>標籤</h4><div className="book-row-tags">{currentBook.tagIds.length ? currentBook.tagIds.map(id => <Tag key={id} kind="tag">{names.get(id) ?? '未設定'}</Tag>) : <span>未設定</span>}</div></div>}
        {(currentBook.rating) && <div className="book-detail-panel-heading"><p>評分｜{currentBook.rating ? `${currentBook.rating.value}／${currentBook.rating.scale}` : '尚未評分'}</p></div>}
        {sourceUrls.length > 0 && <ul className="book-detail-links">{sourceUrls.map(url => { let host = "書籍來源"; try { host = new URL(url).hostname.replace(/^www\./, "") } catch { /* Keep legacy data renderable. */ } const source = host === "books.google.com" ? "Google Books" : host === "bookrep.com.tw" ? "讀書共和國" : host === "readmoo.com" ? "讀墨" : host; return <li key={url}><a href={url} aria-label={`開啟書籍來源：${source}`} title={source} target="_blank" rel="noopener noreferrer"><Icon name="book" size={21} /></a></li> })}</ul>}
      </section>}
      </div>
      </section>
    <ReadingCycleManager readingStatus={<p>閱讀狀態｜{readingStatusLabels[readingStatus]}</p>} readingActions={onStatusChange ? <label className="book-detail-status">閱讀狀態<select aria-label="書籍閱讀狀態" disabled={busy} value={readingStatus} onChange={event => void onStatusChange(event.target.value as Exclude<LibraryReadingStatus, 'unknown'>)}><option value="unknown" disabled>未設定</option>{Object.entries(readingStatusLabels).filter(([value]) => value !== 'unknown').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label> : <p>閱讀狀態｜{readingStatusLabels[readingStatus]}</p>} readingSummary={<BookReadingSummary bookId={book.id} revision={readingRevision} service={overviewService} />} compact revision={syncRevision + readingRevision} bookId={book.id} service={cycleService} recordService={recordService} contentService={contentService} onContentChanged={onContentChanged} onReadingChanged={onReadingChanged} />
    </div>
    {onDelete && <footer className="book-detail-more"><Popover label="書籍操作" trigger={props => <Button size="small" variant="ghost" {...props}>更多書籍操作</Button>} content={<Button size="small" variant="danger" onClick={() => onDelete(currentBook)}>刪除書籍</Button>} /></footer>}
  </article>
}



