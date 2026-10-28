import { useEffect, useRef, useState } from 'react'
import type { CoverSearchCandidate } from '../../domain/cover-search'
import { isBookMetadataCandidate } from '../../domain/book-metadata'
import { validateCoverFile } from './book-cover-upload'
import { Button } from '../../shared/ui/Button'
interface Candidate extends CoverSearchCandidate { source?: string; downloadUrl?: string }
interface Preview { candidate: Candidate; file: File; url: string; width: number; height: number }
function isLibraryCandidate(value: unknown): value is CoverSearchCandidate {
 if (!value || typeof value !== 'object') return false
 const row = value as Partial<CoverSearchCandidate>
 return Number.isSafeInteger(row.coverId) && Number(row.coverId) > 0 && typeof row.title === 'string' && Array.isArray(row.authors) && row.authors.every(name => typeof name === 'string') && typeof row.sourceUrl === 'string' && /^https:\/\/openlibrary.org\/works\/OL\d+W$/.test(row.sourceUrl)
}
export function BookCoverSearch({ title, author, isbn, disabled, onSelect, open, onOpenChange }: { title: string; author: string; isbn: string | null; disabled: boolean; onSelect: (file: File) => void; open?: boolean; onOpenChange?: (open: boolean) => void }) {
 const [queryTitle, setQueryTitle] = useState(title), [queryAuthor, setQueryAuthor] = useState(author), [queryIsbn, setQueryIsbn] = useState(isbn ?? '')
 const [candidates, setCandidates] = useState<Candidate[]>([]), [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [error, setError] = useState('')
 const [source, setSource] = useState('metadata'), [notice, setNotice] = useState('')
 const [preview, setPreview] = useState<Preview | null>(null)
 useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])
 const generation = useRef(0)
 const webQuery = [queryTitle.trim(), queryAuthor.trim(), queryIsbn.trim(), '封面'].filter(Boolean).join(' ')
 const hasWebQuery = Boolean(queryTitle.trim() || queryIsbn.trim())
 const [engine, setEngine] = useState('google')
 const imageSearchUrl = engine === 'bing' ? 'https://www.bing.com/images/search?' + new URLSearchParams({ q: webQuery })
   : engine === 'yahoo' ? 'https://images.search.yahoo.com/search/images?' + new URLSearchParams({ p: webQuery })
   : 'https://www.google.com/search?' + new URLSearchParams({ q: webQuery, udm: '2' })
 useEffect(() => () => { generation.current++ }, [])
 async function search() {
   const current = ++generation.current; setBusy(true); setError(''); setNotice(''); setCandidates([]); setPreview(null); setSearched(false)
   try {
     const params = new URLSearchParams({ title: queryTitle, author: queryAuthor, isbn: queryIsbn })
     const target = source === 'metadata' ? '/api/v1/books/metadata?' + new URLSearchParams({ title: queryTitle, author: queryAuthor, source: 'taiwan' }) : '/api/v1/covers/search?' + params
     const response = await fetch(target, { credentials: 'include' })
     const body = await response.json()
     if (!response.ok) throw new Error(body.error?.message ?? '搜尋失敗')
     if (!Array.isArray(body.data)) throw new Error('搜尋回應無效')
     const data: unknown[] = body.data
     const rows: Candidate[] = source === 'metadata' ? data.filter(isBookMetadataCandidate).filter(row => row.coverUrl?.startsWith('/api/v1/books/metadata/cover?')).map((row, index) => ({ coverId: index + 1, title: row.title, authors: row.authors, source: row.source, sourceUrl: row.sourceUrl, previewUrl: row.coverUrl!, downloadUrl: row.coverUrl!, firstPublishedYear: null, editionCount: null })) : data.filter(isLibraryCandidate).map(row => ({ ...row, previewUrl: `https://covers.openlibrary.org/b/id/${row.coverId}-M.jpg?default=false` }))
     if (current === generation.current) { setCandidates(rows); setSearched(true); if (body.partial) setNotice('部分來源未回應，目前只顯示已取得的封面。') }
   } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : '搜尋失敗') }
   finally { if (current === generation.current) setBusy(false) }
 }
 async function choose(candidate: Candidate) {
   const current = ++generation.current; setBusy(true); setError('')
   try {
     const response = await fetch(candidate.downloadUrl ?? `/api/v1/covers/search/image/${candidate.coverId}`, { credentials: 'include' })
     if (!response.ok) throw new Error('此圖片無法下載，請選另一張或手動上傳')
     const blob = await response.blob()
     const file = new File([blob], '搜尋封面', { type: blob.type })
     validateCoverFile(file)
     const image = await createImageBitmap(file)
     const { width, height } = image; image.close()
     if (!width || !height || width * height > 40_000_000) throw new Error('圖片尺寸無效或過大')
     if (current === generation.current) setPreview({ candidate, file, url: URL.createObjectURL(file), width, height })
   } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : '圖片下載失敗') }
   finally { if (current === generation.current) setBusy(false) }
 }
 return <details className="book-cover-search" open={open} onToggle={event => onOpenChange?.(event.currentTarget.open)}><summary>搜尋封面</summary>
   <p>只選封面，不會帶入書名、作者或其他書目欄位。請核對冊次與版本。</p>
   <label>搜尋書名<input value={queryTitle} disabled={disabled || busy} onChange={event => setQueryTitle(event.target.value)} /></label>
   <label>搜尋作者<input value={queryAuthor} disabled={disabled || busy} onChange={event => setQueryAuthor(event.target.value)} /></label>
   <label>搜尋 ISBN<input value={queryIsbn} disabled={disabled || busy} onChange={event => setQueryIsbn(event.target.value)} /></label>
   <label>封面候選來源<select value={source} disabled={disabled || busy} onChange={event => setSource(event.target.value)}><option value="metadata">書目來源（讀書共和國／角川／Google Books）</option><option value="openlibrary">Open Library</option></select></label>
   <Button disabled={disabled || busy || !(source === 'metadata' ? queryTitle.trim() : queryTitle.trim() || queryIsbn.trim())} onClick={() => void search()}>{busy ? '搜尋或下載中' : searched ? '重新找封面' : '尋找候選封面'}</Button>
   <label>圖片搜尋引擎<select value={engine} onChange={event => setEngine(event.target.value)}><option value="google">Google</option><option value="bing">Bing</option><option value="yahoo">Yahoo</option></select></label>
   {hasWebQuery && <p className="book-cover-web-search"><a href={'https://www.google.com/search?' + new URLSearchParams({ q: webQuery })} target="_blank" rel="noopener noreferrer">網頁搜尋</a>{' · '}<a href={imageSearchUrl} target="_blank" rel="noopener noreferrer">圖片搜尋</a></p>}
   <p>搜尋在新分頁開啟；複製圖片後回來「貼上封面」，預覽後儲存。也可下載圖片再選檔。</p>
   <p>候選來自所選書目來源，不是全網圖片搜尋結果；沒有合適圖片時可使用上方網頁圖片搜尋，再貼回表單。</p>
   {notice && <p role="status">{notice}</p>}
   {error && <p role="alert">{error}</p>}{searched && !candidates.length && <p>查無候選封面，可調整書名、作者或 ISBN，或手動上傳。</p>}
   <div className="book-cover-candidates">{candidates.map(candidate => <div key={candidate.coverId}><img src={candidate.previewUrl} alt={candidate.title + ' 候選封面'} loading="lazy" /><strong>{candidate.title}</strong><span>{candidate.authors.join('、') || '作者未提供'}</span><span>來源：{candidate.source ?? 'Open Library'}</span>{candidate.firstPublishedYear && <span>首次出版：{candidate.firstPublishedYear}</span>}<a href={candidate.sourceUrl} target="_blank" rel="noopener noreferrer">查看來源與版本</a><Button disabled={disabled || busy} onClick={() => void choose(candidate)}>預覽此封面</Button></div>)}</div>
   {preview && <section aria-label="候選封面原圖預覽"><img className="book-cover-editor-preview" src={preview.url} alt={preview.candidate.title + ' 待採用原圖'} /><p>{preview.candidate.title} · {preview.candidate.source ?? 'Open Library'}</p><p>原圖：{preview.width} × {preview.height} 像素 · {Math.ceil(preview.file.size / 1024)} KB</p>{preview.width < 400 && <p>這張是小圖，放大可能模糊；可以選另一張或重新找封面。</p>}<Button disabled={disabled || busy} onClick={() => { onSelect(preview.file); setPreview(null); setNotice('封面已帶入草稿，尚未儲存；書目欄位未變更。') }}>採用這張封面</Button><Button disabled={disabled || busy} onClick={() => setPreview(null)}>放棄這張，選另一張</Button></section>}
 </details>
}
