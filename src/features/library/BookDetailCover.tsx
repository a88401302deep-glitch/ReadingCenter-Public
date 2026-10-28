import { useEffect, useId, useRef, useState } from 'react'
import { getBookDisplayTitle, type Book, type BookCover as Cover } from '../../domain'
import { BookCover, Button } from '../../shared/ui'
import { useAuth } from '../auth/auth-context'
import { BookCoverPaste } from '../books/BookCoverPaste'
import { BookCoverSearch } from '../books/BookCoverSearch'
import { uploadBookCover, validateCoverFile } from '../books/book-cover-upload'
import type { BookDraft } from '../books/book-service'

interface Props {
 showActions?: boolean
 book: Book
 author: string
 busy: boolean
 onDirtyChange: (dirty: boolean) => void
 onPendingChange?: (pending: boolean) => void
 onSave: (draft: BookDraft, revision: number) => Promise<Book | null>
}

export function BookDetailCover({ showActions = true, book, author, busy, onDirtyChange, onPendingChange, onSave }: Props) {
 const { previewReadOnly = false } = useAuth()
 const [selection, setSelection] = useState<{ file: File; url: string; baseline: Book } | null>(null)
 const [mode, setMode] = useState<'search' | 'paste' | null>(null)
 const [pending, setPending] = useState(false)
 const [error, setError] = useState('')
 const [notice, setNotice] = useState('')
 const upload = useRef<Cover | null>(null)
 const lock = useRef(false)
 const fileInput = useRef<HTMLInputElement>(null)
 const dialog = useRef<HTMLDialogElement>(null)
 const returnFocus = useRef<HTMLButtonElement | null>(null)
 const headingId = useId()
 const title = getBookDisplayTitle(book)
 const disabled = busy || pending
 useEffect(() => () => { if (selection) URL.revokeObjectURL(selection.url) }, [selection])
 useEffect(() => {
  if (!mode) return
  const panel = dialog.current
  panel?.showModal()
  panel?.querySelector<HTMLElement>('button, input')?.focus({ preventScroll: true })
  return () => { panel?.close(); returnFocus.current?.focus({ preventScroll: true }) }
 }, [mode])
 const select = (file: File) => {
  if (disabled || lock.current) return
  try {
   validateCoverFile(file)
   setSelection({ file, url: URL.createObjectURL(file), baseline: book })
   upload.current = null
   setError(''); setNotice(''); setMode(null); onDirtyChange(true)
  } catch (reason) { setError(reason instanceof Error ? reason.message : '無法使用此圖片') }
 }
 const discard = () => {
  if (disabled || lock.current) return
  setSelection(null); upload.current = null; setError(''); setNotice(''); onDirtyChange(false)
 }
 const save = async () => {
  if (!selection || disabled || previewReadOnly || lock.current) return
  if (book.revision !== selection.baseline.revision) {
   setError('書籍已有新版本；封面草稿已保留，請取消後重新選圖。'); return
  }
  lock.current = true; setPending(true); onPendingChange?.(true); setError('')
  try {
   const baseline = selection.baseline
   const cover = upload.current ?? await uploadBookCover(baseline, selection.file)
   upload.current = cover
   const updated = await onSave({ title: baseline.title, preferredTitle: baseline.preferredTitle, mediaTypeId: baseline.mediaTypeId, cover }, baseline.revision)
   if (!updated) return
   setSelection(null); upload.current = null; onDirtyChange(false); setNotice('封面已存檔。')
  } catch (reason) { setError(reason instanceof Error ? reason.message : '封面存檔失敗，請重試') }
  finally { lock.current = false; setPending(false); onPendingChange?.(false) }
 }
 return <section className="book-detail-cover-section" aria-label="書籍封面">
  <div className="book-detail-cover-layout">
   <div className="book-detail-cover"><BookCover src={selection?.url ?? book.cover?.path} title={title} /></div>
   <div className="book-detail-introduction"><p className="book-detail-kicker">READING JOURNAL</p><h3>{title}</h3>{author && <p>{author}</p>}</div>
   {showActions && <div className="book-detail-cover-actions" aria-label="封面操作">
    <Button size="small" disabled={disabled} onClick={event => { returnFocus.current = event.currentTarget; setMode('search') }}>尋找</Button>
    <Button size="small" disabled={disabled} onClick={event => { returnFocus.current = event.currentTarget; setMode('paste') }}>更換</Button>
    <Button size="small" disabled={disabled} onClick={() => fileInput.current?.click()}>上傳</Button>
    <input hidden ref={fileInput} aria-label="上傳封面圖片" type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) select(file) }} />
    {selection && <><Button size="small" variant="primary" disabled={disabled || previewReadOnly} onClick={() => void save()}>{pending ? '存檔中' : '存檔'}</Button><Button size="small" disabled={disabled} onClick={discard}>取消換圖</Button></>}
   </div>}
  </div>
  {selection && <p role="status">{previewReadOnly ? '封面試看中；此預覽不儲存或上傳。' : '封面已更換，請存檔。'}</p>}
  {notice && <p role="status">{notice}</p>}
  {error && <p role="alert">{error}</p>}
  {mode && <dialog ref={dialog} className="book-metadata-dialog book-detail-cover-dialog" aria-labelledby={headingId}
   onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMode(null) } if (event.key === 'Tab') event.stopPropagation() }}
   onCancel={event => { event.preventDefault(); event.stopPropagation(); setMode(null) }}
   onClick={event => { if (event.target === event.currentTarget) setMode(null) }}>
   <header className="book-metadata-dialog-heading"><h2 id={headingId}>{mode === 'search' ? '尋找封面' : '貼上更換封面'}</h2><Button onClick={() => setMode(null)}>關閉封面工具</Button></header>
   <div className="book-metadata-dialog-content">{mode === 'search'
    ? <BookCoverSearch embedded title={book.title} author={author} isbn={book.isbn} disabled={disabled} onSelect={select} />
    : <BookCoverPaste disabled={disabled} onSelect={select} />}</div>
   <footer><Button onClick={() => setMode(null)}>返回單書頁</Button></footer>
  </dialog>}
 </section>
}
