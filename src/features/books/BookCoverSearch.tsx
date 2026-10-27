import { useEffect, useRef, useState } from 'react'
import type { CoverSearchCandidate } from '../../domain/cover-search'
import { Button } from '../../shared/ui/Button'
export function BookCoverSearch({ title, author, isbn, disabled, onSelect }: { title: string; author: string; isbn: string | null; disabled: boolean; onSelect: (file: File) => void }) {
 const [queryTitle, setQueryTitle] = useState(title), [queryAuthor, setQueryAuthor] = useState(author), [queryIsbn, setQueryIsbn] = useState(isbn ?? '')
 const [candidates, setCandidates] = useState<CoverSearchCandidate[]>([]), [busy, setBusy] = useState(false), [searched, setSearched] = useState(false), [error, setError] = useState('')
 const generation = useRef(0)
 const webQuery = [queryTitle.trim(), queryAuthor.trim(), queryIsbn.trim(), '封面'].filter(Boolean).join(' ')
 const hasWebQuery = Boolean(queryTitle.trim() || queryIsbn.trim())
 const [engine, setEngine] = useState('google')
 const imageSearchUrl = engine === 'bing' ? 'https://www.bing.com/images/search?' + new URLSearchParams({ q: webQuery })
   : engine === 'yahoo' ? 'https://images.search.yahoo.com/search/images?' + new URLSearchParams({ p: webQuery })
   : 'https://www.google.com/search?' + new URLSearchParams({ q: webQuery, udm: '2' })
 useEffect(() => () => { generation.current++ }, [])
 async function search() {
   const current = ++generation.current; setBusy(true); setError(''); setCandidates([]); setSearched(false)
   try {
     const params = new URLSearchParams({ title: queryTitle, author: queryAuthor, isbn: queryIsbn })
     const response = await fetch('/api/v1/covers/search?' + params, { credentials: 'include' })
     const body = await response.json()
     if (!response.ok) throw new Error(body.error?.message ?? '搜尋失敗')
     if (!Array.isArray(body.data)) throw new Error('搜尋回應無效')
     if (current === generation.current) { setCandidates(body.data); setSearched(true) }
   } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : '搜尋失敗') }
   finally { if (current === generation.current) setBusy(false) }
 }
 async function choose(candidate: CoverSearchCandidate) {
   const current = ++generation.current; setBusy(true); setError('')
   try {
     const response = await fetch(`/api/v1/covers/search/image/${candidate.coverId}`, { credentials: 'include' })
     if (!response.ok) throw new Error('此圖片無法下載，請選另一張或手動上傳')
     const blob = await response.blob()
     if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type) || !blob.size || blob.size > 10 * 1024 * 1024) throw new Error('圖片格式或大小無效')
     if (current === generation.current) onSelect(new File([blob], '搜尋封面', { type: blob.type }))
   } catch (reason) { if (current === generation.current) setError(reason instanceof Error ? reason.message : '圖片下載失敗') }
   finally { if (current === generation.current) setBusy(false) }
 }
 return <details className="book-cover-search"><summary>搜尋封面</summary>
   <label>搜尋書名<input value={queryTitle} disabled={disabled || busy} onChange={event => setQueryTitle(event.target.value)} /></label>
   <label>搜尋作者<input value={queryAuthor} disabled={disabled || busy} onChange={event => setQueryAuthor(event.target.value)} /></label>
   <label>搜尋 ISBN<input value={queryIsbn} disabled={disabled || busy} onChange={event => setQueryIsbn(event.target.value)} /></label>
   <Button disabled={disabled || busy || !queryTitle.trim() && !queryIsbn.trim()} onClick={() => void search()}>{busy ? '搜尋或下載中' : '尋找候選封面'}</Button>
   <label>圖片搜尋引擎<select value={engine} onChange={event => setEngine(event.target.value)}><option value="google">Google</option><option value="bing">Bing</option><option value="yahoo">Yahoo</option></select></label>
   {hasWebQuery && <p className="book-cover-web-search"><a href={'https://www.google.com/search?' + new URLSearchParams({ q: webQuery })} target="_blank" rel="noopener noreferrer">網頁搜尋</a>{' · '}<a href={imageSearchUrl} target="_blank" rel="noopener noreferrer">圖片搜尋</a></p>}
   <p>搜尋在新分頁開啟；複製圖片後回來「貼上封面」，預覽後儲存。也可下載圖片再選檔。</p>
   <p>來源：<a href="https://openlibrary.org" target="_blank" rel="noreferrer">Open Library</a>。請核對版本；中文書與網文可能查無結果。</p>
   {error && <p role="alert">{error}</p>}{searched && !candidates.length && <p>查無候選封面，可調整書名、作者或 ISBN，或手動上傳。</p>}
   <div className="book-cover-candidates">{candidates.map(candidate => <div key={candidate.coverId}><img src={candidate.previewUrl} alt={candidate.title + ' 候選封面'} loading="lazy" /><strong>{candidate.title}</strong><span>{candidate.authors.join('、') || '作者未提供'}</span>{candidate.firstPublishedYear && <span>首次出版：{candidate.firstPublishedYear}</span>}<a href={candidate.sourceUrl} target="_blank" rel="noreferrer">查看來源與版本</a><Button disabled={disabled || busy} onClick={() => void choose(candidate)}>選用此封面</Button></div>)}</div>
 </details>
}
