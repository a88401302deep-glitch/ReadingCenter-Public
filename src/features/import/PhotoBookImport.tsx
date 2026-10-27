import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { Book, DictionaryEntry } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'
import { Button } from '../../shared/ui/Button'
import { confirmPhotoBook, photoTitleKey, matchPhotoBooks, type PhotoBookDraft } from '../../import/photo-book'
import { photoReviewQueue, photoImage, recognizeQueuedPhoto, PhotoRecognitionError, type PhotoReviewItem, type PhotoReviewQueue, type PhotoBookCandidate } from '../../import/photo-review-queue'
import { confirmPhotoReading, emptyPhotoReading, type PhotoReadingDraft } from '../../import/photo-reading'
import { BookMetadataSearch, type MetadataLookupResult } from '../books/BookMetadataSearch'
import { BookForm } from '../books/BookForm'
import { BookService } from '../books/book-service'
import './photo-review.css'

const authorLookup = (entries: DictionaryEntry[]): Record<string, string[]> => Object.fromEntries(entries.filter(entry => entry.kind === 'author').map(entry => [entry.id, [entry.name, ...entry.aliases]]))

export function PhotoBookImport({ repositories, onBack, queue = photoReviewQueue, onChanged }: { repositories: ReadingCenterRepositories; onBack: () => void; queue?: PhotoReviewQueue; onChanged?: () => void }) {
 const [items, setItems] = useState<PhotoReviewItem[]>([]), [activeId, setActiveId] = useState(''), [books, setBooks] = useState<Book[]>([])
 const [metadataEditing, setMetadataEditing] = useState(false), [metadataDictionaries, setMetadataDictionaries] = useState<DictionaryEntry[]>([])
 const [authorNames, setAuthorNames] = useState<Record<string, string[]>>({})
 const [sourceDefault, setSourceDefault] = useState('其他'), [busy, setBusy] = useState(false), [running, setRunning] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState(''), [preview, setPreview] = useState('')
 const [editStatus, setEditStatus] = useState('')
 const editSequence = useRef(0)
 const [metadataLookupCache] = useState(() => new Map<string, MetadataLookupResult>())
 const alive = useRef(true), controller = useRef<AbortController | null>(null), pendingEdits = useRef<Promise<void>>(Promise.resolve())
 const [candidateId, setCandidateId] = useState('')
 const photo = items.find(item => item.id === activeId)
 const candidate = photo?.candidates?.find(value => value.id === candidateId) ?? photo?.candidates?.find(value => value.status === 'pending') ?? photo?.candidates?.[0]
 const active = photo && candidate ? { ...photo, ...candidate, id: photo.id, status: candidate.status === 'pending' ? photo.status : 'saved' as const } : photo
 useEffect(() => {
  alive.current = true
  void Promise.all([queue.list(), repositories.books.getAll(), repositories.dictionaries.getAll()]).then(([rows, books, dictionaries]) => { if (alive.current) { setItems(rows); setActiveId(rows.find(row => row.status !== 'saved')?.id ?? rows[0]?.id ?? ''); setBooks(books); setAuthorNames(authorLookup(dictionaries)); setMetadataDictionaries(dictionaries) } }).catch(() => { if (alive.current) setError('無法讀取待確認匣或書庫，請重新開啟') })
  return () => { alive.current = false; controller.current?.abort() }
 }, [queue, repositories])
 useEffect(() => {
  const image = active?.image
  let cancelled = false
  if (!image) { queueMicrotask(() => { if (!cancelled && alive.current) setPreview('') }); return () => { cancelled = true } }
  const url = URL.createObjectURL(photoImage(image))
  queueMicrotask(() => { if (!cancelled && alive.current) setPreview(url) })
  return () => { cancelled = true; URL.revokeObjectURL(url) }
 }, [active?.id, active?.image])
 const refresh = async () => { const rows = await queue.list(); if (alive.current) setItems(rows); return rows }
 const edit = (changes: Partial<Pick<PhotoBookCandidate, 'draft' | 'source' | 'mediaType' | 'bookId' | 'allowSameTitle'>>) => {
  if (!active || busy || active.status === 'saved') return
  const id = active.id, currentCandidateId = candidate?.id, sequence = ++editSequence.current
  setEditStatus('saving')
  setItems(rows => rows.map(row => row.id === id ? currentCandidateId ? { ...row, candidates: row.candidates?.map(value => value.id === currentCandidateId ? { ...value, ...changes, id: value.id, status: value.status } : value) } : { ...row, ...changes } : row))
  pendingEdits.current = pendingEdits.current.then(() => currentCandidateId ? queue.patchCandidate(id, currentCandidateId, changes) : queue.patch(id, changes)).then(() => { if (alive.current && sequence === editSequence.current) setEditStatus('saved') }).catch(reason => { if (alive.current) { setEditStatus('error'); setError('核對內容未能保存，請重新開啟此頁：' + (reason instanceof Error ? reason.message : '儲存失敗')) }; throw reason })
  // Keep the chain rejected so confirmation cannot use a draft that failed to persist.
  void pendingEdits.current.catch(() => undefined)
 }
 async function choose(event: ChangeEvent<HTMLInputElement>) {
  const files = [...(event.target.files ?? [])]; event.target.value = ''; if (!files.length || busy) return
  if (files.length > 20) { setError('一次最多選擇 20 張圖片'); return }
  setBusy(true); setError(''); setMessage('正在保存圖片…')
  const failures: string[] = []; let added = 0, duplicates = 0, first = ''
  try {
   for (const file of files) {
    if (!alive.current) break
    try { const result = await queue.add(file, sourceDefault); first ||= result.id; if (result.duplicate) duplicates++; else added++ }
    catch (reason) { failures.push(`${file.name}：${reason instanceof Error ? reason.message : '無法加入'}`) }
   }
   await refresh()
   if (alive.current) { if (first) setActiveId(first); setMessage(`已加入 ${added} 張${duplicates ? `，跳過 ${duplicates} 張重複圖片` : ''}。尚未送出辨識。`); setError(failures.join('；')) }
  } finally { if (alive.current) setBusy(false) }
 }
 async function recognize(ids: string[]) {
  if (busy || !ids.length) return
  if (ids.some(id => items.find(item => item.id === id)?.status === 'ready') && !window.confirm('重新辨識會取代尚未確認的候選與修正，確定要繼續嗎？')) return
  setBusy(true); setError(''); setMessage(''); const task = new AbortController(); controller.current = task
  try {
   await pendingEdits.current
   for (const [index, id] of ids.entries()) {
    task.signal.throwIfAborted(); const item = await queue.items.get(id)
    if (!item?.image || item.status === 'saved') continue
    if (alive.current) { setRunning(id); setMessage(`辨識 ${index + 1}／${ids.length}：${item.filename}`) }
    try {
     const drafts = await recognizeQueuedPhoto(photoImage(item.image), task.signal)
     task.signal.throwIfAborted()
     await queue.setCandidates(id, drafts)
     if (alive.current) setCandidateId('')
    } catch (reason) {
     if (task.signal.aborted) break
     await queue.patch(id, { status: 'error', error: reason instanceof Error ? reason.message : '辨識失敗' })
     if (reason instanceof PhotoRecognitionError && [0, 401, 429, 503].includes(reason.status)) { if (alive.current) setError('本批辨識已停止，其餘圖片保留待處理。'); await refresh(); break }
    }
    await refresh()
   }
   if (alive.current) setMessage(task.signal.aborted ? '已停止辨識，待處理圖片仍保留。' : '本批辨識已結束，請逐項核對後確認匯入。')
  } catch (reason) { if (alive.current && !task.signal.aborted) setError(reason instanceof Error ? reason.message : '無法辨識') }
  finally { if (alive.current) { setBusy(false); setRunning('') } }
 }
 async function save(event: FormEvent) {
  event.preventDefault(); if (!active || busy || active.status === 'saved' || !active.draft.title.trim()) return
  setBusy(true); setError(''); setMessage('')
  try {
   await pendingEdits.current
   const item = await queue.items.get(active.id); if (!item || item.status === 'saved') return
   const selected = candidate ? item.candidates?.find(value => value.id === candidate.id) : undefined
   if (candidate && (!selected || selected.status !== 'pending')) throw new Error('候選狀態已有更新，請重新載入')
   const review = selected ?? item
   const existing = (await repositories.books.getAll()).find(book => book.externalReferences.some(ref => ref.sourceId === 'photo-import' && ref.externalId === `${item.hash}:${photoTitleKey(review.draft.title)}${selected?.variant ? `:${selected.variant}` : ''}`))
   const book = existing ?? await confirmPhotoBook(repositories, review.draft, { bookId: review.bookId, hash: item.hash, source: review.source, mediaType: review.mediaType, allowSameTitle: review.allowSameTitle, candidateKey: selected?.variant })
   await queue.finish(item.id, book.id, selected?.id); await refresh()
   if (selected && alive.current) setCandidateId(selected.id)
   onChanged?.()
   const [latestBooks, dictionaries] = await Promise.all([repositories.books.getAll(), repositories.dictionaries.getAll()])
   if (alive.current) { setBooks(latestBooks); setAuthorNames(authorLookup(dictionaries)); setMetadataDictionaries(dictionaries); setMessage(`已確認${review.bookId || existing ? '連結' : '新增'}《${book.title}》。閱讀紀錄與封面未由此照片建立。`); }
  } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '保存失敗，請核對後重試') }
  finally { if (alive.current) setBusy(false) }
 }
 async function remove(id: string) {
  if (busy) return
  try { await pendingEdits.current; await queue.remove(id); const rows = await refresh(); if (alive.current && activeId === id) setActiveId(rows.find(row => row.status !== 'saved')?.id ?? rows[0]?.id ?? '') }
  catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '無法移除圖片') }
 }
 const reading = active?.reading ?? { ...emptyPhotoReading, completedOn: active?.draft.completedOn ?? '', totalMinutes: active?.draft.totalMinutes ?? '' }
 const editReading = (changes: Partial<PhotoReadingDraft>) => {
  if (!active || busy || active.savedReadingCycleId) return
  const id = active.id, selectedId = candidate?.id, value = { ...reading, ...changes }, sequence = ++editSequence.current
  setEditStatus('saving')
  setItems(rows => rows.map(row => row.id === id ? selectedId ? { ...row, candidates: row.candidates?.map(item => item.id === selectedId ? { ...item, reading: value } : item) } : { ...row, reading: value } : row))
  pendingEdits.current = pendingEdits.current.then(() => queue.patchReading(id, selectedId, value)).then(() => { if (alive.current && sequence === editSequence.current) setEditStatus('saved') }).catch(reason => { if (alive.current) { setEditStatus('error'); setError(reason instanceof Error ? reason.message : '閱讀核對內容未能保存') }; throw reason })
  void pendingEdits.current.catch(() => undefined)
 }
 async function saveReading(event: FormEvent) {
  event.preventDefault()
  if (!active || busy || !active.savedBookId || active.savedReadingCycleId) return
  setBusy(true); setError(''); setMessage('')
  try {
   await pendingEdits.current
   const item = await queue.items.get(active.id), selected = candidate ? item?.candidates?.find(value => value.id === candidate.id) : item
   if (!item || !selected?.savedBookId || selected.savedReadingCycleId) throw new Error('候選狀態已有更新，請重新載入')
   const value = selected.reading ?? { ...emptyPhotoReading, completedOn: selected.draft.completedOn ?? '', totalMinutes: selected.draft.totalMinutes ?? '' }
   const cycle = await confirmPhotoReading(repositories, selected.savedBookId, item.hash, value)
   await queue.patchReading(item.id, candidate?.id, value, cycle.id)
   await refresh(); onChanged?.()
   if (alive.current) setMessage('已確認保存完讀日期與累計閱讀時間；未新增書籍或封面。')
  } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '閱讀紀錄保存失敗') }
  finally { if (alive.current) setBusy(false) }
 }
 const metadataBook = books.find(book => book.id === active?.savedBookId)
 const matches = active ? matchPhotoBooks(books, active.draft, authorNames) : []
 const locked = busy || active?.status === 'saved'
 const field = (key: keyof PhotoBookDraft, value: string) => { if (active) edit({ draft: { ...active.draft, [key]: value }, ...(key === 'title' ? { bookId: null, allowSameTitle: false } : {}) }) }
 return <section aria-label="拍照辨識書名" className="photo-review">
  <div className="form-actions"><h2>拍照／截圖待確認匣</h2><Button onClick={onBack} disabled={busy}>返回匯入</Button></div>
  <p>一次可選多張圖片，同張清單截圖可拆出多本書，逐本核對。每張最多 10 筆候選；若清單較長，可分段截圖。待確認圖片與修正內容保存在此裝置，可稍後繼續；確認成功後釋放圖片。</p>
  <label>本批圖片來源<select value={sourceDefault} disabled={busy} onChange={event => setSourceDefault(event.target.value)}>{['其他','微信讀書','BookWalker','讀墨','圖書館','實體書'].map(name => <option key={name}>{name}</option>)}</select></label>
  <label>選擇照片或截圖<input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => void choose(event)} /></label>
  <p>待確認匣最多 20 張圖片，不跨裝置同步，也不包含在書庫資料備份。按辨識才會將縮小圖片送至辨識服務。</p>
  <div className="form-actions"><Button disabled={busy || !items.some(item => item.status === 'pending' || item.status === 'error')} onClick={() => void recognize(items.filter(item => item.status === 'pending' || item.status === 'error').map(item => item.id))}>辨識所有待處理圖片</Button>{busy && running && <Button onClick={() => controller.current?.abort()}>停止本批辨識</Button>}</div>
  <p>待處理 {items.filter(item => item.status === 'pending' || item.status === 'error').length} 張；待確認 {items.filter(item => item.status === 'ready').length} 張；已完成 {items.filter(item => item.status === 'saved').length} 張。</p>
  <div className="photo-review-list" aria-label="圖片待確認清單">{items.map(item => <div key={item.id}><button type="button" disabled={busy} aria-current={item.id === activeId ? 'true' : undefined} onClick={() => { setActiveId(item.id); setCandidateId(''); setError(''); setMessage('') }}>{item.filename} · {item.status === 'saved' ? '已完成' : item.status === 'ready' ? '待確認' : item.status === 'error' ? '辨識失敗' : '待辨識'}{running === item.id ? ' · 處理中' : ''}</button><Button disabled={busy} onClick={() => void remove(item.id)}>{item.status === 'saved' ? '移除完成項目' : '移除圖片'}</Button></div>)}</div>
  {active && <>
   {preview && <img src={preview} alt="待核對照片" />}
   {photo?.status !== 'saved' && <Button disabled={busy || !active.image || Boolean(photo?.candidates?.some(value => value.status === 'saved'))} onClick={() => void recognize([active.id])}>{active.status === 'ready' ? '重新辨識目前圖片' : '開始辨識書名'}</Button>}
   {active.error && <p role="alert">{active.error}</p>}
   {photo?.candidates && photo.candidates.length > 0 && <nav aria-label="同張圖片的書籍候選">{photo.candidates.map((value,index) => <Button key={value.id} disabled={busy} onClick={() => { setCandidateId(value.id); setError(''); setMessage('') }}>候選 {index+1}：{value.draft.title || '書名待填'} · {value.status === 'saved' ? value.savedReadingCycleId ? '書籍與閱讀紀錄已確認' : '書籍已確認'  : value.status === 'ignored' ? '已略過' : '待確認'}</Button>)}</nav>}
   {candidate?.status === 'pending' && <Button disabled={busy} onClick={() => { void pendingEdits.current.then(() => queue.patchCandidate(active.id, candidate.id, { status: 'ignored' })).then(refresh).catch(reason => { if (alive.current) setError(reason instanceof Error ? reason.message : '無法略過候選') }) }}>略過目前候選</Button>}

   {metadataBook && <section aria-label="補全已匯入書籍資料">
    <Button disabled={busy} onClick={() => setMetadataEditing(value => !value)}>補全書籍資料與封面</Button>
    {metadataEditing && <BookForm key={metadataBook.id + ':' + metadataBook.revision} book={metadataBook} dictionaries={metadataDictionaries} busy={busy} onCancel={() => setMetadataEditing(false)} onSubmit={async draft => {
     setBusy(true); setError('')
     try {
      await new BookService(repositories).update(metadataBook.id, draft, metadataBook.revision)
      const [latest, dictionaries] = await Promise.all([repositories.books.getAll(), repositories.dictionaries.getAll()])
      if (alive.current) { setBooks(latest); setMetadataDictionaries(dictionaries); setAuthorNames(authorLookup(dictionaries)); setMetadataEditing(false); setMessage('書籍資料已保存；沒有新增書籍或閱讀紀錄。') }
      onChanged?.()
     } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : '書籍資料保存失敗') }
     finally { if (alive.current) setBusy(false) }
    }} />}
   </section>}
   {editStatus === 'saving' && <p role="status">正在保存核對內容…</p>}{editStatus === 'saved' && <p role="status">核對內容已保存。</p>}
   {active.status !== 'saved' && <BookMetadataSearch key={candidate?.id ?? active.id} autoSearch={active.status === 'ready'} lookupCache={metadataLookupCache} title={active.draft.title} author={active.draft.author} mediaTypeId={active.mediaType} currentValues={{ title: active.draft.title, authors: active.draft.author, publisher: active.draft.publisher, isbn: active.draft.isbn, publishedOn: active.draft.publishedOn ?? '' }} supportedFields={['title', 'authors', 'publisher', 'isbn', 'publishedOn']} disabled={busy} onSelect={(value, replace, fields) => {
    const useAuthors = fields.includes('authors') && (replace || !active.draft.author.trim())
    const versionMatches = replace || !['讀書共和國', '台灣角川'].includes(value.source) || active.mediaType !== 'ebook'
    edit({ draft: { ...active.draft,
     title: fields.includes('title') && (replace || !active.draft.title.trim()) ? value.title : active.draft.title,
     author: useAuthors && value.authors.length ? value.authors.join('、') : active.draft.author,
     authors: useAuthors && value.authors.length ? value.authors : active.draft.authors,
     publisher: fields.includes('publisher') && (replace || !active.draft.publisher.trim()) && value.publisher ? value.publisher : active.draft.publisher,
     isbn: fields.includes('isbn') && versionMatches && (replace || !active.draft.isbn.trim()) && value.isbn ? value.isbn : active.draft.isbn,
     publishedOn: fields.includes('publishedOn') && versionMatches && (replace || !active.draft.publishedOn) && value.publishedOn ? value.publishedOn : active.draft.publishedOn,
     metadataSourceUrl: value.sourceUrl
    }, ...(replace ? { bookId: null, allowSameTitle: false } : {}) })
   }} />}
   <form className="entity-form" onSubmit={event => void save(event)}>
    <label>來源<select value={active.source} disabled={locked} onChange={event => edit({ source: event.target.value })}>{['其他','微信讀書','BookWalker','讀墨','圖書館','實體書'].map(name => <option key={name}>{name}</option>)}</select></label>
    {([['title','核對書名',300],['author','核對作者',200],['publisher','核對出版社',200],['isbn','核對 ISBN',40]] as const).map(([key,label,max]) => <label key={key}>{label}<input required={key === 'title'} maxLength={max} value={active.draft[key]} disabled={locked} onChange={event => field(key, event.target.value)} /></label>)}
    <label>書庫比對<select value={active.bookId ?? 'new'} disabled={locked} onChange={event => edit({ bookId: event.target.value === 'new' ? null : event.target.value })}><option value="new">建立新書籍</option>{[...new Map([...matches, ...books.filter(book => book.id === active.bookId)].map(book => [book.id,book])).values()].map(book => <option key={book.id} value={book.id}>{book.title} · {book.authorIds.map(id => authorNames[id]?.[0]).filter(Boolean).join('、') || '作者未設定'} · {book.isbn || 'ISBN 未設定'} · {book.id.slice(-8)}</option>)}</select></label>
    {!active.bookId && <><label>媒體類型<select value={active.mediaType} disabled={locked} onChange={event => edit({ mediaType: event.target.value })}><option value="ebook">電子書</option><option value="print">紙本書</option><option value="manga">漫畫</option><option value="other">其他</option></select></label>{matches.length > 0 && <label><input type="checkbox" checked={active.allowSameTitle} disabled={locked} onChange={event => edit({ allowSameTitle: event.target.checked })} />已核對同名候選，這是不同作品或版本</label>}</>}
    <p>連結既有書只補空白作者、出版社及 ISBN，保留人工資料。圖片不直接當封面；閱讀時間與完讀日期請在下方另行核對確認。</p>
    {active.draft.visibleText && <details><summary>查看辨識原文</summary><p>{active.draft.visibleText}</p></details>}
    <Button type="submit" disabled={locked || !active.draft.title.trim()}>確認匯入書籍資料</Button>
   </form>
   {candidate?.status !== 'ignored' && <form className="entity-form" aria-label="核對閱讀紀錄" onSubmit={event => void saveReading(event)}>
    <h3>核對閱讀紀錄</h3>
    {!active.savedBookId && <p>先確認上方書籍配對，再另外確認閱讀紀錄。</p>}
    <label>完讀日期<input type="date" required value={reading.completedOn} disabled={busy || Boolean(active.savedReadingCycleId)} onChange={event => editReading({ completedOn: event.target.value })} /></label>
    <label>累計閱讀時間（分鐘）<input type="number" min="0" step="1" value={reading.totalMinutes} disabled={busy || Boolean(active.savedReadingCycleId)} onChange={event => editReading({ totalMinutes: event.target.value })} /></label>
    <p>日期與時間請逐本核對；不確定的時間可留白。累計時長不代表完讀當天的閱讀時間。</p>
    <label><input type="checkbox" checked={reading.allowReread} disabled={busy || Boolean(active.savedReadingCycleId)} onChange={event => editReading({ allowReread: event.target.checked })} />若已有完讀紀錄，已核對本次為另一次重讀</label>
    <Button type="submit" disabled={busy || !active.savedBookId || Boolean(active.savedReadingCycleId) || !reading.completedOn}>{active.savedReadingCycleId ? '閱讀紀錄已保存' : '確認匯入閱讀紀錄'}</Button>
   </form>}
  </>}
  {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
 </section>
}
