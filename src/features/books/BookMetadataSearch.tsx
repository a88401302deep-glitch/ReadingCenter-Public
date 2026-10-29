import { metadataDiagnosticMessages } from './metadata-diagnostics'
import { useAuth } from '../auth/auth-context'
import { parseReadmooMetadataText } from '../../domain/readmoo-metadata-text'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MetadataSearchProgress } from './MetadataSearchProgress'
import { defaultMetadataFields, isBookMetadataCandidate, metadataFields, metadataFieldValue, METADATA_FIELD_LABELS, type BookMetadataField, type BookMetadataCandidate } from '../../domain/book-metadata'
import { Button } from '../../shared/ui/Button'
export interface MetadataLookupResult { candidates: BookMetadataCandidate[]; partial: boolean; warning?: string; warnings?: string[]; diagnostics?: string[] }
export function BookMetadataSearch({ title, author, disabled, currentValues, mediaTypeId, supportedFields, onSelect, onCover, autoSearch = false, lookupCache, embeddedInDialog = false, onBusyChange }: { embeddedInDialog?: boolean; onBusyChange?: (busy: boolean) => void; autoSearch?: boolean; lookupCache?: Map<string, MetadataLookupResult>; title: string; author: string; disabled: boolean; currentValues?: Partial<Record<BookMetadataField, string>>; mediaTypeId?: string; supportedFields?: BookMetadataField[]; onSelect: (candidate: BookMetadataCandidate, replace: boolean, fields: BookMetadataField[]) => void; onCover?: (file: File) => void }) {
 const { previewReadOnly = false } = useAuth()
 const [query, setQuery] = useState(title), [queryAuthor, setQueryAuthor] = useState(author), [replace, setReplace] = useState(false)
 const [candidates, setCandidates] = useState<BookMetadataCandidate[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(''), [searched, setSearched] = useState(false), [incomplete, setIncomplete] = useState(false)
 const [diagnostics, setDiagnostics] = useState<string[]>([])
 useEffect(() => { onBusyChange?.(busy) }, [busy, onBusyChange])
 const [selected, setSelected] = useState<Record<string, BookMetadataField[]>>({})
 const [source, setSource] = useState('taiwan'), [bookUrl, setBookUrl] = useState('')
 const [pastedText, setPastedText] = useState('')
 const [activeId, setActiveId] = useState<string | null>(null), [notice, setNotice] = useState(''), [chosenCover, setChosenCover] = useState<string | null>(null)
 const reviewHeading = useRef<HTMLHeadingElement>(null), feedback = useRef<HTMLParagraphElement>(null)
 useEffect(() => { if (activeId) reviewHeading.current?.focus() }, [activeId])
 useEffect(() => { if (notice) feedback.current?.focus() }, [notice])
 function choose(id: string) { setActiveId(id); setReplace(false); setNotice(''); setChosenCover(null) }
 const formConflict = (candidate: BookMetadataCandidate) => Boolean(!replace && candidate.bookForm && currentValues?.bookForm?.trim() && currentValues.bookForm.trim() !== metadataFieldValue(candidate, 'bookForm'))
 function state(candidate: BookMetadataCandidate, field: BookMetadataField): string {
  if (!(selected[candidate.id] ?? []).includes(field)) return '不帶入'
  if (formConflict(candidate)) return '需核對作品形式'
  if (!replace && ['讀書共和國', '台灣角川'].includes(candidate.source) && mediaTypeId === 'ebook' && ['isbn', 'publishedOn'].includes(field)) return '需核對版本'
  const value = currentValues?.[field]?.trim()
  if (value && !replace) return '保留原資料'
  if (value && value === metadataFieldValue(candidate, field).trim()) return '資料相同'
  return value ? '將取代' : '將補入'
 }
 function apply(candidate: BookMetadataCandidate) {
  const fields = (selected[candidate.id] ?? []).filter(field => (!supportedFields || supportedFields.includes(field)) && ['將補入', '將取代'].includes(state(candidate, field)))
  if (fields.length) onSelect(candidate, replace, fields)
  setNotice(fields.length ? '已帶入下列表單：' + fields.map(field => METADATA_FIELD_LABELS[field]).join('、') + '。' + (previewReadOnly ? '此頁僅供預覽，尚未儲存到書庫。' : '尚未儲存，確認表單後再按儲存。') : '原有資料已保留，沒有需要補入的欄位。')
 }
 const generation = useRef(0), requestController = useRef<AbortController | null>(null)
 const [searching, setSearching] = useState(false)
 const automaticAttempt = useRef(false)
 const queryEdited = useRef(false), authorEdited = useRef(false)
 useEffect(() => { if (!queryEdited.current) setQuery(title) }, [title])
 useEffect(() => { if (!authorEdited.current) setQueryAuthor(author) }, [author])
 useEffect(() => () => { generation.current++; requestController.current?.abort() }, [])
 const cancelSearch = useCallback(() => {
  generation.current++; requestController.current?.abort(); setSearching(false); setBusy(false)
  setError('已取消搜尋；書名與閱讀紀錄仍保留，可直接確認匯入或重試。')
 }, [])
 const search = useCallback(async (retry = false) => {
  requestController.current?.abort()
  const task = new AbortController(); requestController.current = task
  const current = ++generation.current; setBusy(true); setSearching(true); setError(''); setDiagnostics([]); setCandidates([]); setSelected({}); setReplace(false); setSearched(false); setIncomplete(false); setActiveId(null); setNotice(''); setChosenCover(null)
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; task.abort() }, 25000)
  try {
   if (source === 'readmoo-text') {
    const { candidate, warnings } = parseReadmooMetadataText(pastedText, bookUrl, query)
    setCandidates([candidate]); setActiveId(candidate.id); setSelected({ [candidate.id]: defaultMetadataFields(candidate) }); setSearched(true); setError(warnings.join('；')); return
   }
   const cacheKey = JSON.stringify([source, query.trim(), queryAuthor.trim(), source === 'pubu' ? bookUrl.trim() : ''])
   const cached = retry ? undefined : lookupCache?.get(cacheKey)
   let result: MetadataLookupResult
   if (cached) result = cached
   else {
    const response = await fetch('/api/v1/books/metadata?' + new URLSearchParams(source === 'pubu' ? { source, url: bookUrl.trim() } : { title: query.trim(), author: queryAuthor.trim(), source }), { credentials: 'include', signal: task.signal })
    const body = await response.json()
    if (current === generation.current && !task.signal.aborted) setDiagnostics(metadataDiagnosticMessages(body.diagnostics))
    if (!response.ok) throw new Error(body.error?.message ?? '書籍搜尋失敗')
    if (!Array.isArray(body.data)) throw new Error('搜尋回應無效')
    const parsed = body.data.filter(isBookMetadataCandidate).slice(0, 13)
    if (body.data.length && !parsed.length) throw new Error('來源已回傳資料，但候選格式無法辨識；請重試或改用網頁搜尋。')
    result = { candidates: parsed, warnings: Array.isArray(body.warnings) ? body.warnings.filter((value: unknown): value is string => typeof value === 'string' && value.length <= 300).slice(0, 3) : [], partial: Boolean(body.partial), diagnostics: metadataDiagnosticMessages(body.diagnostics), ...(typeof body.warning === 'string' ? { warning: body.warning.slice(0, 300) } : {}) }
   }
   if (current === generation.current && !task.signal.aborted) {
    if (!result.partial) lookupCache?.set(cacheKey, result)
    setDiagnostics(result.diagnostics ?? [])
    const rows = result.candidates
    setCandidates(rows)
    if ((autoSearch || source === 'pubu') && rows.length === 1) setActiveId(rows[0].id)
    setSelected(Object.fromEntries(rows.map(row => [row.id, defaultMetadataFields(row)]))); setSearched(true)
    setIncomplete(result.partial || Boolean(result.warning))
    setError([result.warning, result.partial ? (result.warnings?.join('；') || (rows.length ? '部分來源暫時無法使用。' : '部分來源搜尋失敗。')) + (rows.length ? '仍可核對下方結果。' : '尚未取得可用候選，可重試、改用其他來源或手動填寫。') : ''].filter(Boolean).join(' '))
   }
  } catch (reason) {
   if (current === generation.current) setError(timedOut ? '搜尋逾時；書名與閱讀紀錄仍保留，可直接確認匯入或重試。' : reason instanceof Error ? reason.message : '搜尋失敗')
  } finally {
   clearTimeout(timeout)
   if (current === generation.current) { setBusy(false); setSearching(false) }
  }
 }, [source, query, queryAuthor, bookUrl, pastedText, autoSearch, lookupCache])
 useEffect(() => {
  if (!autoSearch || disabled || !title.trim() || automaticAttempt.current) return
  let cancelled = false
  queueMicrotask(() => {
   if (cancelled || automaticAttempt.current) return
   automaticAttempt.current = true
   void search()
  })
  return () => { cancelled = true }
 }, [autoSearch, disabled, title, search])
 async function cover(candidate: BookMetadataCandidate) {
  if (!candidate.coverUrl?.startsWith('/api/v1/books/metadata/cover?') || !onCover) return
  const current = ++generation.current; setBusy(true); setError('')
  try {
   const response = await fetch(candidate.coverUrl, { credentials: 'include' })
   if (!response.ok) throw new Error('封面無法取得，可用原有的上傳或貼上封面')
   const blob = await response.blob()
   if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || !blob.size || blob.size > 10 * 1024 * 1024) throw new Error('封面格式或大小無效')
   if (current === generation.current) {
    onCover(new File([blob], '候選封面', { type: blob.type })); setChosenCover(candidate.id)
    setNotice('封面已選取，可在下列表單看到預覽。' + (previewReadOnly ? '此頁不會上傳或儲存。' : '尚未儲存。'))
   }
  } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : '封面預覽失敗') }
  finally { if (current === generation.current) setBusy(false) }
 }
 const content = <div className="metadata-flow">
  <p className="metadata-step">{activeId ? '2 · 核對這一本' : '1 · 搜尋並選一本'}</p>
  <div className="metadata-query-stage" hidden={Boolean(activeId)}>

  {source === 'pubu' ? <label>Pubu 書頁網址<input type="url" value={bookUrl} maxLength={200} placeholder="https://www.pubu.com.tw/ebook/697279" disabled={disabled || busy} onChange={event => setBookUrl(event.target.value)} /></label> : <><label>{source === 'readmoo-text' ? '核對書名' : '查詢書名'}<input value={query} maxLength={300} disabled={disabled || busy} onChange={event => { queryEdited.current = true; setQuery(event.target.value) }} /></label>
  </>}
<details className="metadata-search-options"><summary>其他查詢方式與來源</summary>
  <label>書目來源<select value={source} disabled={disabled || busy} onChange={event => { generation.current++; setSource(event.target.value); setDiagnostics([]); setCandidates([]); setSelected({}); setError(''); setSearched(false); setReplace(false); setActiveId(null); setNotice(''); setChosenCover(null) }}><option value="taiwan">臺灣書目（讀書共和國＋角川）</option><option value="kadokawa">台灣角川（小說／漫畫）</option><option value="openlibrary">Open Library（其他來源）</option><option value="readmoo-text">讀墨（貼上書籍資料文字）</option><option value="pubu">Pubu（貼上書頁網址）</option></select></label>
{source !== 'readmoo-text' && <label>查詢作者（選填）<input value={queryAuthor} maxLength={200} disabled={disabled || busy} onChange={event => { authorEdited.current = true; setQueryAuthor(event.target.value) }} /></label>}
</details>
  {source === 'readmoo-text' && <>
   <label>讀墨書頁網址<input type="url" value={bookUrl} maxLength={200} placeholder="https://readmoo.com/book/210304417000101" disabled={disabled || busy} onChange={event => setBookUrl(event.target.value)} /></label>
   <label>讀墨書籍資料文字<textarea rows={7} maxLength={20000} value={pastedText} disabled={disabled || busy} onChange={event => setPastedText(event.target.value)} /></label>
   <p>確認上方書名，貼上同一本書的作者、出版社、字數等資料區文字。整理在此裝置進行；這個選項尚不支援網址自動查詢，也不會擷取封面。</p>
  </>}
  <Button disabled={disabled || busy || (source === 'readmoo-text' && (!bookUrl.trim() || !pastedText.trim())) || !(source === 'pubu' ? bookUrl.trim() : query.trim())} onClick={() => void search(true)}>{busy ? '查詢中…' : source === 'readmoo-text' ? '整理成候選資料' : '查詢書籍資料'}</Button>
  {source === 'pubu' && <p>貼上單本電子書的公開書頁網址取得候選。ISBN、出版日期及系列需另外勾選；字數可能與其他平台不同，請核對版本。</p>}
  <p><a href={'https://www.google.com/search?' + new URLSearchParams({ q: [query, queryAuthor, '書籍 出版社'].filter(Boolean).join(' ') })} target="_blank" rel="noopener noreferrer">網頁搜尋書籍資料</a></p>
  {searched && !candidates.length && !incomplete && <p>查無書目資料；已保留書名與閱讀紀錄，可直接確認匯入，日後再補全。</p>}
  <div className="metadata-book-results">{candidates.map(candidate => <article className="metadata-book-result" key={candidate.id}>
   {candidate.coverUrl?.startsWith('/api/v1/books/metadata/cover?') && <img src={candidate.coverUrl} alt={candidate.title + ' 版本封面'} loading="lazy" />}
   <div><strong>{candidate.title}</strong><span>{candidate.bookForm === 'novel' ? '小說 · ' : candidate.bookForm === 'manga' ? '漫畫 · ' : ''}{candidate.authors.join('、') || '作者未提供'}</span><small>{[candidate.publisher, candidate.publishedOn, candidate.source].filter(Boolean).join(' · ')}</small><Button disabled={disabled || busy} onClick={() => choose(candidate.id)} aria-label={'核對《' + candidate.title + '》'}>選這本</Button></div>
  </article>)}</div>
  </div>
  {candidates.filter(candidate => candidate.id === activeId).map(candidate => <section className="metadata-review" key={candidate.id}>
   <Button disabled={disabled || busy} onClick={() => { setActiveId(null); setReplace(false); setNotice('') }}>返回搜尋結果</Button>
   <div className="metadata-chosen-book">
    {candidate.coverUrl?.startsWith('/api/v1/books/metadata/cover?') && <img src={candidate.coverUrl} alt={candidate.title + ' 已選版本封面'} />}
    <div><h3 ref={reviewHeading} tabIndex={-1}>{candidate.title}</h3><p>{candidate.authors.join('、')}</p><p>{[candidate.publisher, candidate.publishedOn].filter(Boolean).join(' · ')}</p>
     <a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">{candidate.source} · 查看原書頁</a>
     {onCover && candidate.coverUrl && <Button disabled={disabled || busy || formConflict(candidate) || chosenCover === candidate.id} onClick={() => void cover(candidate)}>{chosenCover === candidate.id ? '封面已選取 ✓' : '使用這張封面'}</Button>}
    </div>
   </div>
   {formConflict(candidate) && <p role="alert">此候選的作品形式與目前書籍不同，尚未帶入資料或封面。請返回改選，或核對後在進階設定允許取代。</p>}
   <p>{previewReadOnly ? '這一步只改預覽表單，不會儲存書庫。' : '帶入後仍可修改，最後按儲存才更新書庫。'}</p>
   <dl className="metadata-review-rows">{metadataFields.filter(field => (!supportedFields || supportedFields.includes(field)) && metadataFieldValue(candidate, field)).map(field => <div key={field}>
    <dt>{METADATA_FIELD_LABELS[field]}</dt><dd><span>{metadataFieldValue(candidate, field)}</span><small>{state(candidate, field)}</small>{currentValues?.[field]?.trim() && currentValues[field]?.trim() !== metadataFieldValue(candidate, field).trim() && <span className="metadata-existing">目前：{currentValues[field]}</span>}</dd>
   </div>)}</dl>
   <details className="metadata-advanced"><summary>調整帶入欄位或取代既有資料</summary>
    <label className="metadata-replace-choice"><input type="checkbox" checked={replace} disabled={disabled || busy} onChange={event => setReplace(event.target.checked)} />已核對版本，允許候選取代目前欄位</label>
    <fieldset className="metadata-field-choices" disabled={disabled || busy}><legend>選擇要套用的欄位：{candidate.title}</legend>
     {metadataFields.filter(field => !supportedFields || supportedFields.includes(field)).map(field => { const value = metadataFieldValue(candidate, field); return value ? <label key={field}><input type="checkbox" checked={(selected[candidate.id] ?? []).includes(field)} onChange={event => setSelected(previous => ({ ...previous, [candidate.id]: event.target.checked ? [...(previous[candidate.id] ?? []), field] : (previous[candidate.id] ?? []).filter(item => item !== field) }))} />{METADATA_FIELD_LABELS[field]}：{value}</label> : null })}
    </fieldset>
    <p>ISBN、出版日期請核對版本；系列與卷次需自行勾選，不會依同名或同作者自動合併。</p>
   </details>
   <Button variant="primary" disabled={disabled || busy || formConflict(candidate) || !(selected[candidate.id]?.length)} onClick={() => apply(candidate)}>帶入下列表單</Button>
  </section>)}
  {diagnostics.length > 0 && <ul aria-label="搜尋來源狀態">{diagnostics.map(message => <li key={message}>{message}</li>)}</ul>}
  {error && <div><p role="alert">{error}</p><Button disabled={disabled || busy} onClick={() => void search(true)}>重試搜尋</Button></div>}
  {searching && <MetadataSearchProgress onCancel={cancelSearch} />}
  {notice && <p className="metadata-feedback" role="status" ref={feedback} tabIndex={-1}>{notice}</p>}
  </div>
 return embeddedInDialog ? content : <details className="book-metadata-search" open={autoSearch || undefined}><summary>搜尋並補全書籍資料</summary>{content}</details>
}
