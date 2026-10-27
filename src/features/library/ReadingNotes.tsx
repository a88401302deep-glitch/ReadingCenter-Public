import { ReadingContentDate } from '../reading-contents/ReadingContentDate'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { getBookDisplayTitle, type Book, type ReadingContent, type ReadingContentType, type ReadingCycle } from '../../domain'
import { BookCover, Button, FormMessage, Icon, IconButton, Modal } from '../../shared/ui'
import { ReadingContentService, type ReadingContentDraft } from '../reading-contents/reading-content-service'

interface Props {
  books: Book[]
  onChanged: () => void
  onOpenBook: (book: Book) => void
  revision: number
  service: ReadingContentService
}

const typeLabel: Record<ReadingContentType, string> = { highlight: '畫線', shortReview: '短評', longReview: '長篇心得' }

export function ReadingNotes({ books, onChanged, onOpenBook, revision, service }: Props) {
  const [contents, setContents] = useState<ReadingContent[]>([])
  const [cycles, setCycles] = useState<ReadingCycle[]>([])
  const [query, setQuery] = useState('')
  const [bookId, setBookId] = useState('')
  const [type, setType] = useState<ReadingContentType | ''>('')
  const [editing, setEditing] = useState<ReadingContent | null>(null)
  const [deleting, setDeleting] = useState<ReadingContent | null>(null)
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [locator, setLocator] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const returnPoint = useRef<{ x: number; y: number; target: HTMLElement } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const bookMap = useMemo(() => new Map(books.map((book) => [book.id, book])), [books])
  const dirty = Boolean(editing && (text !== editing.text
    || editing.type === 'longReview' && title !== (editing.title ?? '')
    || editing.type === 'highlight' && (note !== (editing.note ?? '') || locator !== (editing.locator ?? ''))))
  const rememberPosition = (target: HTMLElement) => { returnPoint.current = { x: window.scrollX, y: window.scrollY, target } }
  const canDiscard = () => !pending.current && (!dirty || window.confirm('尚有未儲存的變更，確定要離開嗎？'))
  const closeEditor = () => { if (!pending.current) { setEditing(null); setError(null) } }
  const closeDelete = () => { if (!pending.current) { setDeleting(null); setError(null) } }

  useEffect(() => {
    if (editing || deleting || !returnPoint.current) return
    const point = returnPoint.current
    returnPoint.current = null
    const frame = requestAnimationFrame(() => {
      const target = point.target.isConnected ? point.target : searchRef.current
      target?.focus({ preventScroll: true })
      window.scrollTo(point.x, point.y)
    })
    return () => cancelAnimationFrame(frame)
  }, [editing, deleting])

  useEffect(() => {
    let cancelled = false
    void Promise.all([service.listAll(), service.listReadingCycles()]).then(([items, readingCycles]) => { if (!cancelled) { setContents(items); setCycles(readingCycles) } })
    return () => { cancelled = true }
  }, [revision, service])

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('zh-TW')
    return contents.filter((content) => {
      const book = bookMap.get(content.bookId)
      const searchable = [content.text, book ? getBookDisplayTitle(book) : '', content.type === 'longReview' ? content.title ?? '' : '', content.type === 'highlight' ? `${content.note ?? ''} ${content.locator ?? ''}` : ''].join(' ').toLocaleLowerCase('zh-TW')
      return (!needle || searchable.includes(needle)) && (!bookId || content.bookId === bookId) && (type ? content.type === type : content.type !== 'highlight')
    })
  }, [bookId, bookMap, contents, query, type])

  const openEdit = (content: ReadingContent, target: HTMLElement) => {
    if (pending.current) return
    rememberPosition(target)
    setEditing(content)
    setText(content.text)
    setTitle(content.type === 'longReview' ? content.title ?? '' : '')
    setNote(content.type === 'highlight' ? content.note ?? '' : '')
    setLocator(content.type === 'highlight' ? content.locator ?? '' : '')
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editing || pending.current) return
    const base = { cycleId: editing.cycleId, readingRecordId: editing.readingRecordId, recordedForAt: editing.recordedForAt, text }
    const draft: ReadingContentDraft = editing.type === 'highlight'
      ? { ...base, type: editing.type, note, locator }
      : editing.type === 'longReview' ? { ...base, type: editing.type, title } : { ...base, type: editing.type }
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const updated = await service.update(editing.id, draft, editing.revision)
      setContents(current => current.map(item => item.id === updated.id ? updated : item))
      setEditing(null)
      onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法儲存閱讀筆記') }
    finally { pending.current = false; setBusy(false) }
  }

  const confirmDelete = async () => {
    if (!deleting || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await service.delete(deleting.id)
      setContents(current => current.filter(item => item.id !== deleting.id))
      setDeleting(null)
      onChanged()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法刪除閱讀筆記') }
    finally { pending.current = false; setBusy(false) }
  }

  return <section className="reading-notes">
    <div className="notes-tools">
      <label className="search-field"><Icon name="search" size={17} /><span className="sr-only">搜尋閱讀筆記</span><input ref={searchRef} aria-label="搜尋閱讀筆記" placeholder="搜尋書名或筆記內容" type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>書籍<select aria-label="依書籍篩選" value={bookId} onChange={(event) => setBookId(event.target.value)}><option value="">全部書籍</option>{books.map((book) => <option key={book.id} value={book.id}>{getBookDisplayTitle(book)}</option>)}</select></label>
      <label>類型<select aria-label="依內容類型篩選" value={type} onChange={(event) => setType(event.target.value as ReadingContentType | '')}><option value="">全部心得</option>{Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    <div className="notes-count">{results.length} 筆</div>
    {contents.length === 0 ? <p className="empty-line">尚無閱讀筆記</p> : results.length === 0 ? <p className="empty-line">沒有符合條件的閱讀筆記</p> : <ol className="notes-stream">{results.map((content) => {
      const book = bookMap.get(content.bookId)
      return <li className="note-card" key={content.id}>
        <div className="note-card-cover">
          {book ? <BookCover src={book.cover?.path} title={getBookDisplayTitle(book)} /> : <div className="note-cover-missing" aria-hidden="true"><Icon name="book" size={28} /></div>}
          <div className="notes-actions" role="group" aria-label={`${book ? getBookDisplayTitle(book) : '書籍已不存在'}的${typeLabel[content.type]}操作`}>
            <IconButton aria-label="編輯" title={`編輯${typeLabel[content.type]}`} disabled={busy} onClick={event => openEdit(content, event.currentTarget)}><Icon name="editNote" size={18} /></IconButton>
            <IconButton aria-label="刪除" title={`刪除${typeLabel[content.type]}`} tone="danger" disabled={busy} onClick={event => { if (pending.current) return; rememberPosition(event.currentTarget); setError(null); setDeleting(content) }}><Icon name="deleteNote" size={18} /></IconButton>
          </div>
        </div><div className="note-card-body">
        <div className="notes-meta"><span>{typeLabel[content.type]}</span>{book ? <button className="note-book-title" type="button" onClick={() => onOpenBook(book)}>{getBookDisplayTitle(book)}</button> : <strong>書籍已不存在</strong>}<ReadingContentDate content={content} cycles={cycles} /></div>
        {content.type === 'longReview' && content.title && <h3>{content.title}</h3>}
        <p>{content.text}</p>
        {content.type === 'highlight' && content.note && <p className="notes-annotation">{content.note}</p>}
        {content.type === 'highlight' && content.locator && <small>{content.locator}</small>}
      </div></li>
    })}</ol>}
    <Modal open={editing !== null} title={editing ? `編輯${typeLabel[editing.type]}` : '編輯閱讀筆記'} trapFocus hasUnsavedChanges={dirty || busy} confirmDiscard={canDiscard} onClose={closeEditor}>
      {editing && <form className="entity-form notes-edit-form" aria-busy={busy} onSubmit={submit}>
        <p className="notes-editor-book">{bookMap.has(editing.bookId) ? getBookDisplayTitle(bookMap.get(editing.bookId)!) : '書籍已不存在'}</p>
        <fieldset className="notes-edit-fields" disabled={busy}>
          {editing.type === 'longReview' && <label>標題<input value={title} onChange={event => setTitle(event.target.value)} /></label>}
          <label>內容<textarea aria-label="內容" required rows={editing.type === 'highlight' ? 4 : 12} value={text} onChange={event => setText(event.target.value)} /></label>
          {editing.type === 'highlight' && <><label>附註<textarea aria-label="附註" rows={3} value={note} onChange={event => setNote(event.target.value)} /></label><label>位置<input value={locator} onChange={event => setLocator(event.target.value)} /></label></>}
        </fieldset>
        <div>{error && <FormMessage tone="error">{error}</FormMessage>}</div>
        <div className="form-actions"><Button disabled={busy} onClick={() => { if (canDiscard()) closeEditor() }}>取消</Button><Button disabled={busy} type="submit" variant="primary">{busy ? '儲存中…' : '儲存'}</Button></div>
      </form>}
    </Modal>
    <Modal open={deleting !== null} title="刪除閱讀筆記" trapFocus hasUnsavedChanges={busy} confirmDiscard={() => false} onClose={closeDelete}>
      {deleting && <div className="delete-confirmation notes-delete-dialog" aria-busy={busy}>
        <p>確定刪除這筆{typeLabel[deleting.type]}？</p>
        {error && <FormMessage tone="error">{error}</FormMessage>}
        <div className="form-actions"><Button disabled={busy} onClick={closeDelete}>取消</Button><Button disabled={busy} variant="danger" onClick={() => void confirmDelete()}>{busy ? '刪除中…' : '確認刪除'}</Button></div>
      </div>}
    </Modal>
  </section>
}
