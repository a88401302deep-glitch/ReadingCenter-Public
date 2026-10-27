import { useEffect, useMemo, useRef, useState } from 'react'
import { openMoonBackup, type MoonBackup, type MoonBook } from '../../import/moon-backup-reader'
import { combineMoonStatistics } from '../../import/moon-statistics'
import { findMoonBookCandidates, moonDayDate, moonSourceTitle, type MoonCatalog } from '../../import/moon-book-matching'
import { type MoonStatistic } from '../../import/moon-statistics'
import { uploadMoonCover } from '../../import/moon-cover-upload'
import { importMoonBackupBatch } from '../../import/moon-backup-batch-import'
import type { ReadingCenterRepositories } from '../../data'
import type { SourceReadingDay } from '../../domain'
import './moon-backup-preview.css'
import { MoonSourceMatches } from './MoonSourceMatches'
const devices = ['BOOX TUCP', 'BOOX PALMA2', 'BIGME B7PRO']
interface Snapshot { id: number; deviceId: string; name: string; backup: MoonBackup }
function CoverImage({ book, backup, path }: { book: MoonBook; backup: MoonBackup; path: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false, objectUrl: string | undefined
    void backup.readCover(path).then(blob => {
      if (cancelled) return
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl)
    }).catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [backup, path])
  return url ? <img alt={`${book.title}封面`} src={url} /> : <span>{error ? '圖片無法讀取' : '載入圖片…'}</span>
}
function Cover({ book, backup, selectedPath, onSelect }: { book: MoonBook; backup: MoonBackup; selectedPath: string | null; onSelect: (path: string) => void }) {
  if (book.coverPath) return <CoverImage book={book} backup={backup} path={book.coverPath} />
  if (!book.coverCandidates?.length) return <span>備份無對應圖片</span>
  return <div className="moon-cover-candidates"><p>原引用圖片缺少；以下僅為同名編號候選，請目視確認：</p>{book.coverCandidates.map(path => <button className={selectedPath === path ? 'is-selected' : ''} key={path} type="button" aria-label={`選用候選封面：${path.split('/').at(-1)}`} aria-pressed={selectedPath === path} onClick={() => onSelect(path)}><CoverImage book={book} backup={backup} path={path} /><span>{path.split('/').at(-1)} · 選用此封面</span></button>)}</div>
}
function displayMoonDate(dayCode: number) {
  try { return moonDayDate(dayCode) } catch { return '日期待核對' }
}
function StatisticReview({ statistic, deviceId, catalogs, disputed, onDisputed }: { statistic: MoonStatistic; deviceId: string; catalogs: MoonCatalog[]; disputed: boolean; onDisputed: (value: boolean) => void }) {
  const candidates = findMoonBookCandidates(statistic.path, deviceId, catalogs)
  return <details><summary>{moonSourceTitle(statistic.path)} · {(statistic.durationMs / 3600000).toFixed(2)} 小時 · {statistic.readWords.toLocaleString()} 字{disputed ? ' · 完讀有疑義' : ''}</summary>
    <p className="moon-source-path">來源路徑：{statistic.path}</p>
    <p>{candidates.some(candidate => candidate.evidence === '完整路徑') ? '來源完整路徑對應書目。' : candidates.length ? `找到 ${candidates.length} 組書目候選，格式、作者與版本仍需核對。` : '沒有書目候選，保留來源統計與檔名，待整理書籍資料。'}</p>
    {candidates.length > 0 && <ul>{candidates.map((candidate, index) => <li key={index}>{candidate.title} · {candidate.author || '作者未設定'} · {candidate.evidence}<details><summary>查看候選來源（{candidate.sources.length}）</summary>{candidate.sources.map(source => <p className="moon-source-path" key={`${source.deviceId}:${source.path}`}>{source.deviceId}：{source.path}</p>)}</details></li>)}</ul>}
    <label><input type="checkbox" checked={disputed} onChange={event => onDisputed(event.target.checked)} />完讀紀錄有疑義</label>
    {disputed && <p>已標記待核對；原始進度與閱讀量保留，此預覽不確認完讀。匯入時一併保存核對標記。</p>}
    {statistic.days.map(day => <p key={day.dayCode}>{displayMoonDate(day.dayCode)} · 日碼 {day.dayCode} · {day.durationMs} 毫秒 · {day.readWords} 字 · {day.progressPercent}%{day.progressPercent === 100 ? disputed ? '（有疑義，待核對）' : '（來源完讀）' : ''}</p>)}
  </details>
}
export function MoonBackupPreview({ onBack, repositories }: { onBack?: () => void; repositories?: ReadingCenterRepositories }) {
  const [deviceId, setDeviceId] = useState(devices[0])
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [disputed, setDisputed] = useState<Set<string>>(new Set())
  const [stored, setStored] = useState<SourceReadingDay[]>([])
  const [result, setResult] = useState('')
  const [coverChoices, setCoverChoices] = useState<Record<string, string>>({})
  useEffect(() => { let cancelled = false; if (repositories) void repositories.sourceReadingDays.getAll().then(rows => { if (!cancelled) setStored(rows) }).catch(() => { if (!cancelled) setError('已存來源資料讀取失敗，請重新載入') }); return () => { cancelled = true } }, [repositories])
  async function persist() {
    if (!repositories || busy) return
    setBusy(true); setError(null); setResult('')
    try {
      const selectedSnapshots = snapshots.map(snapshot => ({ ...snapshot, backup: {
        ...snapshot.backup,
        books: snapshot.backup.books.map(book => {
          const selected = coverChoices[JSON.stringify([snapshot.id, book.path])]
          return selected ? { ...book, coverPath: selected } : book
        })
      } }))
      const saved = await importMoonBackupBatch(repositories, selectedSnapshots.map(s => ({ deviceId: s.deviceId, name: s.name, backup: s.backup })), disputed, new Date().toISOString(), { saveCover: uploadMoonCover })
      setStored(await repositories.sourceReadingDays.getAll())
      setResult(`新增書目 ${saved.booksCreated} 本；連結既有書目 ${saved.booksMatched} 本；待確認 ${saved.booksPending} 組。新增每日統計 ${saved.statistics.imported} 列；跳過相同紀錄 ${saved.statistics.skipped} 列。保存封面 ${saved.coversSaved} 張${saved.coverWarnings.length ? `；${saved.coverWarnings.length} 張未保存：${saved.coverWarnings.join('；')}` : ''}。雲端同步狀態請見頁面上方。`)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '匯入失敗；請保留備份後重試') }
    finally { setBusy(false) }
  }
  const [limits, setLimits] = useState<Record<number, number>>({})
  const alive = useRef(true), sequence = useRef(0)
  useEffect(() => { alive.current = true; return () => { alive.current = false; } }, [])
  const combined = useMemo(() => combineMoonStatistics(snapshots.map(s => ({ deviceId: s.deviceId, statistics: s.backup.statistics }))), [snapshots])
  const catalogs = useMemo(() => snapshots.map(snapshot => ({ deviceId: snapshot.deviceId, books: snapshot.backup.books })), [snapshots])
  async function select(file: File) {
    const request = ++sequence.current
    setBusy(true); setError(null)
    try {
      const backup = await openMoonBackup(file)
      if (alive.current && request === sequence.current) setSnapshots(previous => [...previous, { id: request, name: file.name, deviceId, backup }])
    } catch (reason) { if (alive.current && request === sequence.current) setError(reason instanceof Error ? reason.message : '無法讀取備份') }
    finally { if (alive.current && request === sequence.current) setBusy(false) }
  }
  return <section className="moon-preview"><h2>靜讀天下備份預覽</h2><p>選擇來源裝置與 .mrpro 備份。按一次匯入即可批次新增書目、連結可辨識的書籍並保存每日統計；無法判斷的項目保留待確認，不建立完讀週期。</p>
    <div className="form-actions"><label>來源裝置<select disabled={busy} value={deviceId} onChange={event => setDeviceId(event.target.value)}>{devices.map(device => <option key={device}>{device}</option>)}</select></label><label>選擇備份<input disabled={busy} type="file" accept=".mrpro" onChange={event => { const file = event.target.files?.[0]; if (file) void select(file); event.target.value = '' }} /></label><button type="button" onClick={onBack}>返回</button></div>
    {busy && <p role="status">正在讀取備份…</p>}{error && <p role="alert">{error}</p>}
    {result && <p role="status">{result}</p>}
    {stored.length > 0 && <section aria-label="已保存來源統計"><h3>已保存來源統計</h3><p>{stored.length} 列 · {(stored.reduce((sum, row) => sum + row.durationMs, 0) / 3600000).toFixed(2)} 小時 · {stored.reduce((sum, row) => sum + row.readWords, 0).toLocaleString()} 字</p><details><summary>來源每日紀錄</summary>{stored.filter(row => `${row.sourceTitle} ${row.deviceId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(row => <p className="moon-source-path" key={row.id}>{row.deviceId} · {row.sourceTitle} · {row.date} · {row.durationMs} 毫秒 · {row.readWords} 字 · {row.progressPercent}%{row.completionDisputed ? '（有疑義）' : row.progressPercent === 100 ? '（來源完讀）' : ''} · {row.bookId ? '已配對' : '尚未配對'}<br />日碼 {row.dayCode} · {row.sourcePath}</p>)}</details></section>}
    {snapshots.length > 0 && <><h3>閱讀量預覽</h3>{repositories && <button type="button" disabled={busy || combined.conflictCount > 0 || combined.records.length === 0} onClick={() => void persist()}>匯入書目與統計</button>}<p>時數 {combined.durationMs === null ? '待核對' : `${(combined.durationMs / 3600000).toFixed(2)} 小時`} · 閱讀字數 {combined.readWords === null ? '待核對' : combined.readWords.toLocaleString()}</p><p>相同裝置與路徑的相同每日紀錄已去重 {combined.duplicateDays} 列；差異待核對 {combined.conflictCount} 組。</p><p>包含實際重讀；跨裝置統計依各機獨立的規則加總。日期依三台裝置抽樣確認的規則換算，保留原始日碼；100% 採為來源完讀；同書跨裝置或多個日期不直接增加完讀本數或重讀次數。</p><label>搜尋備份書籍<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label></>}
    {repositories && stored.length > 0 && <MoonSourceMatches rows={stored} repositories={repositories} onSaved={async () => setStored(await repositories.sourceReadingDays.getAll())} />}
    {snapshots.map(snapshot => {
      const filtered = snapshot.backup.books.filter(book => `${book.title} ${book.author}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
      return <section key={snapshot.id}><h3>{snapshot.deviceId} · {snapshot.name}</h3><button type="button" disabled={busy} onClick={() => setSnapshots(previous => previous.filter(s => s.id !== snapshot.id))}>移除此預覽</button><p>{snapshot.backup.books.length} 筆書籍 · {snapshot.backup.books.filter(book => book.coverPath).length} 筆有圖片對應 · {snapshot.backup.books.filter(book => !book.coverPath && book.coverCandidates?.length && !coverChoices[JSON.stringify([snapshot.id, book.path])]).length} 筆尚有待核對圖片候選 · {snapshot.backup.statistics.length} 筆逐書統計</p><p>搜尋結果 {filtered.length} 筆，目前顯示 {Math.min(filtered.length, limits[snapshot.id] ?? 40)} 筆。</p><div className="moon-books">{filtered.slice(0, limits[snapshot.id] ?? 40).map((book, i) => { const key = JSON.stringify([snapshot.id, book.path]); return <article key={`${book.path}:${i}`}><Cover book={book} backup={snapshot.backup} selectedPath={coverChoices[key] ?? null} onSelect={path => setCoverChoices(previous => ({ ...previous, [key]: path }))} /><h4>{book.title}</h4><p>{book.author || '作者未設定'}</p></article> })}</div>{filtered.length > (limits[snapshot.id] ?? 40) && <button type="button" onClick={() => setLimits(previous => ({ ...previous, [snapshot.id]: (previous[snapshot.id] ?? 40) + 40 }))}>顯示更多書籍</button>}<details><summary>逐書閱讀統計與每日原值</summary>{snapshot.backup.statistics.map((statistic, i) => <StatisticReview key={`${statistic.path}:${i}`} statistic={statistic} deviceId={snapshot.deviceId} catalogs={catalogs} disputed={disputed.has(JSON.stringify([snapshot.deviceId, statistic.path]))} onDisputed={value => setDisputed(previous => { const next = new Set(previous); const key = JSON.stringify([snapshot.deviceId, statistic.path]); if (value) next.add(key); else next.delete(key); return next })} />)}</details></section>
    })}
  </section>
}

