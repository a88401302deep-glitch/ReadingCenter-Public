import { useEffect, useMemo, useState } from 'react'
import type { ReadingCenterRepositories } from '../../data'
import { getBookDisplayTitle, type Book, type DictionaryEntry, type SourceReadingDay } from '../../domain'
import { linkMoonSourceGroup } from '../../import/moon-source-link'

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}]/gu, '')
type MatchStatus = 'unmatched' | 'partial' | 'review' | 'linked'
const statusLabel: Record<MatchStatus, string> = { unmatched: '尚未配對', partial: '部分配對', review: '需重新核對', linked: '已配對' }
function matchStatus(rows: SourceReadingDay[], bookIds: Set<string>): MatchStatus {
  const linked = rows.filter(row => row.bookId)
  if (!linked.length) return 'unmatched'
  if (linked.some(row => !bookIds.has(row.bookId!)) || new Set(linked.map(row => row.bookId)).size > 1) return 'review'
  return linked.length === rows.length ? 'linked' : 'partial'
}
function SourceMatch({ rows, books, authors, status, repositories, onSaved }: {
  rows: SourceReadingDay[]; books: Book[]; authors: Map<string, string>; status: MatchStatus
  repositories: ReadingCenterRepositories; onSaved: (notice: string) => Promise<void>
}) {
  const first = rows[0]
  const initialId = rows.every(row => row.bookId === first.bookId) ? first.bookId ?? '' : ''
  const [selected, setSelected] = useState(initialId)
  const [query, setQuery] = useState(first.sourceTitle)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const label = (book: Book) => getBookDisplayTitle(book) + ' · ' + (book.authorIds.map(id => authors.get(id)).filter(Boolean).join('、') || '作者未設定')
  const candidates = books.filter(book => book.id === selected
    || [getBookDisplayTitle(book), book.title, ...book.titleAliases].some(title => normalize(title).includes(normalize(query)))
    || book.authorIds.some(id => normalize(authors.get(id) ?? '').includes(normalize(query))))
  async function save() {
    setBusy(true); setError('')
    try {
      const count = await linkMoonSourceGroup(repositories, rows, selected || null)
      await onSaved('已更新 ' + count + ' 列來源配對。雲端同步狀態請見頁面上方。')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '配對失敗，請重新核對') }
    finally { setBusy(false) }
  }
  return <details className="moon-source-match">
    <summary>{first.sourceTitle} · {first.deviceId} · {rows.length} 列 · {statusLabel[status]}</summary>
    <p className="moon-source-path">來源路徑：{first.sourcePath}</p>
    <p>{(rows.reduce((sum, row) => sum + row.durationMs, 0) / 3600000).toFixed(2)} 小時 · {rows.reduce((sum, row) => sum + row.readWords, 0).toLocaleString()} 字</p>
    {rows.some(row => row.bookId) && <p>目前配對：{[...new Set(rows.map(row => row.bookId).filter(Boolean))].map(id => {
      const book = books.find(item => item.id === id); return book ? label(book) : '書籍已不存在'
    }).join('；')}</p>}
    <label>搜尋正式書籍<input type="search" value={query} disabled={busy} onChange={event => setQuery(event.target.value)} /></label>
    <label>正式書籍<select value={selected} disabled={busy} onChange={event => setSelected(event.target.value)}>
      <option value="">尚未配對</option>
      {candidates.map(book => <option key={book.id} value={book.id}>{label(book)}</option>)}
    </select></label>
    {!candidates.length && <p>未找到符合書名或作者的正式書籍，請調整搜尋文字。</p>}
    <p>請核對書名、作者與版本；套用至此裝置及路徑的全部每日紀錄。</p>
    <button type="button" disabled={busy || (selected === initialId && rows.every(row => (row.bookId ?? '') === selected))} onClick={() => void save()}>保存書籍配對</button>
    {error && <p role="alert">{error}</p>}
  </details>
}

export function MoonSourceMatches({ rows, repositories, onSaved }: {
  rows: SourceReadingDay[]; repositories: ReadingCenterRepositories; onSaved: () => Promise<void>
}) {
  const [books, setBooks] = useState<Book[]>([])
  const [dictionary, setDictionary] = useState<DictionaryEntry[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'pending' | 'linked' | 'all'>('pending')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void Promise.all([repositories.books.getAll(), repositories.dictionaries.getAll()]).then(([loadedBooks, loadedDictionary]) => {
      if (!cancelled) { setBooks(loadedBooks.sort((a, b) => getBookDisplayTitle(a).localeCompare(getBookDisplayTitle(b)))); setDictionary(loadedDictionary) }
    }).catch(() => { if (!cancelled) setError('正式書籍載入失敗，請重新載入') })
    return () => { cancelled = true }
  }, [repositories])
  const authors = useMemo(() => new Map(dictionary.filter(item => item.kind === 'author').map(item => [item.id, item.name])), [dictionary])
  const groups = useMemo(() => {
    const result = new Map<string, SourceReadingDay[]>()
    for (const row of rows) {
      const key = JSON.stringify([row.deviceId, row.sourcePath])
      result.set(key, [...(result.get(key) ?? []), row])
    }
    return [...result.entries()]
  }, [rows])
  const bookIds = new Set(books.map(book => book.id))
  const pending = groups.filter(([, items]) => matchStatus(items, bookIds) !== 'linked').length
  const filtered = groups.filter(([, items]) => {
    const status = matchStatus(items, bookIds)
    return (filter === 'all' || (filter === 'pending' ? status !== 'linked' : status === 'linked')) && normalize([items[0].sourceTitle, items[0].deviceId, items[0].sourcePath].join(' ')).includes(normalize(search))
  })
  const saved = async (message: string) => { await onSaved(); setNotice(message) }
  return <section aria-label="來源書籍配對">
    <h3>來源書籍配對</h3>
    <p>按裝置與路徑核對既有書籍，保留各來源的閱讀量、日期與進度。</p>
    <label>配對範圍<select value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="pending">待處理（{pending} 組）</option><option value="linked">已配對（{groups.length - pending} 組）</option><option value="all">全部（{groups.length} 組）</option></select></label>
    <label>搜尋已存來源書名<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
    <p>{groups.length} 組來源 · {rows.filter(row => row.bookId).length}／{rows.length} 列已配對 · 目前顯示 {filtered.length} 組</p>
    {notice && <p role="status">{notice}</p>}
    {!filtered.length && <p>{search ? '沒有符合搜尋的來源。' : filter === 'pending' ? '目前沒有待處理的來源配對。' : '此範圍沒有來源紀錄。'}</p>}
    {error && <p role="alert">{error}</p>}
    {filtered.map(([key, items]) => <SourceMatch key={key} rows={items} books={books} authors={authors} status={matchStatus(items, bookIds)} repositories={repositories} onSaved={saved} />)}
  </section>
}

