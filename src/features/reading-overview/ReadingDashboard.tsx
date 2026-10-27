import { useEffect, useState } from 'react'
import { getBookDisplayTitle, type Book } from '../../domain'
import { BookCover, Icon, IconButton } from '../../shared/ui'
import { QuickProgressEditor } from './QuickProgressEditor'
import type { QuickProgressService } from './quick-progress-service'
import { CoverPreview } from '../../shared/ui/CoverPreview'
import { BookProgress } from '../../shared/ui/BookProgress'
import { JournalEmptyState } from '../../shared/ui/JournalEmptyState'
import { bookReadingDays, readingProgressLabel } from './book-reading-days'
import { HomeSummaryPanels } from './HomeSummaryPanels'
import { ReadingOverviewService, type ReadingMetrics, type ReadingOverview } from './reading-overview-service'
const emptyMetrics: ReadingMetrics = { bookCount: 0, completedBookCount: 0, readingDays: 0, totalMinutes: 0, recordCount: 0 }
const formatDuration = (value: number) => { const minutes = Math.round(value); return minutes < 60 ? `${minutes} 分鐘` : `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分` }
interface DashboardProps { progressService?: QuickProgressService; onProgressChanged?: () => void; onOpenBook: (book: Book) => void; revision: number; service: ReadingOverviewService }
export function ReadingDashboard({ onOpenBook, revision, service, progressService, onProgressChanged }: DashboardProps) {
 const [overview, setOverview] = useState<ReadingOverview | null>(null)
 const [error, setError] = useState('')
 const [progressBook, setProgressBook] = useState<Book | null>(null)
 const [previewBook, setPreviewBook] = useState<Book | null>(null)
 useEffect(() => { let cancelled = false; void service.getOverview().then(value => { if (!cancelled) { setOverview(value); setError('') } }).catch(() => { if (!cancelled) setError('閱讀資料載入失敗，請重新整理') }); return () => { cancelled = true } }, [revision, service])
 const recent = overview?.recentBooks.slice(0, 10) ?? []
 return <div className="reading-dashboard reading-overview journal-home" data-view="reading">
  {error && <p role="alert">{error}</p>}
  <section className="overview-recent" aria-label="最近閱讀"><div className="journal-heading"><h1>最近閱讀</h1><span aria-hidden="true">READING DAYS</span></div>
   {recent.length ? <ol className="recent-book-list recent-book-cards">{recent.map(item => { const title = getBookDisplayTitle(item.book); return <li key={item.book.id} className={`journal-book-card is-${item.status ?? 'reading'}`}><button aria-label={`放大《${title}》封面`} type="button" onClick={() => setPreviewBook(item.book)}><div className="recent-book-cover"><BookCover src={item.book.cover?.path} title={title} /></div><span className="sr-only">{title}</span></button><div className="recent-book-progress-row"><BookProgress progress={item.progress} quiet completed={item.status === 'completed'} />{progressService && item.status === 'reading' && <IconButton className="recent-progress-action" aria-label={`更新《${title}》進度`} title="更新閱讀進度" onClick={() => setProgressBook(item.book)}><Icon name="plus" size={18} /></IconButton>}</div></li> })}</ol> : <JournalEmptyState busy={!overview && !error} title={error || (overview ? '從一本書開始，留下你的閱讀紀錄。' : '正在載入書籍…')} />}
  </section>
  {progressBook && progressService && <QuickProgressEditor key={progressBook.id} book={progressBook} service={progressService} onClose={() => setProgressBook(null)} onSaved={() => { setProgressBook(null); onProgressChanged?.() }} />}
  {previewBook && <CoverPreview book={previewBook} onClose={() => setPreviewBook(null)} />}
  {overview?.summaries && <HomeSummaryPanels summaries={overview.summaries} onOpenBook={onOpenBook} />}
 </div>
}

interface SummaryProps { bookId: string; revision: number; service: ReadingOverviewService }

export function BookReadingSummary({ bookId, revision, service }: SummaryProps) {
  const [result, setResult] = useState<{ bookId: string; revision: number; service: ReadingOverviewService; overview: ReadingOverview } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void service.getOverview().then(overview => {
      if (!cancelled) { setResult({ bookId, revision, service, overview }); setError('') }
    }).catch(() => { if (!cancelled) setError('閱讀資料載入失敗，請重新整理') })
    return () => { cancelled = true }
  }, [bookId, revision, service])
  const overview = result?.bookId === bookId && result.revision === revision && result.service === service ? result.overview : null
  const metrics = overview?.byBook[bookId] ?? emptyMetrics
  const recent = overview?.recentBooks.find(item => item.book.id === bookId)
  const days = overview ? bookReadingDays(overview, bookId) : []
  const completion = days.find(day => day.completed)
  const completionRange = overview?.timeline?.entries.find(entry => entry.book.id === bookId && entry.kind === 'completion' && entry.cycle.completionDate?.precision === 'range' && entry.cycle.completionDate.completedOn === completion?.date)
  const range = completionRange?.kind === 'completion' && completionRange.cycle.completionDate?.precision === 'range' ? completionRange.cycle.completionDate : null
  const hasDuration = recent?.hasRecordedDuration === true
  return <section className="book-reading-summary" aria-label="單書閱讀統計" aria-busy={!overview && !error}>
    {error ? <p role="alert">{error}</p> : !overview ? <p role="status">正在載入閱讀紀錄…</p> : <>
      <div><span>完讀</span><strong>{metrics.completedBookCount ? '是' : '否'}</strong></div>
      <div><span>進度</span><strong>{readingProgressLabel(recent?.progress)}</strong></div>
      {completion && <div><span>{range ? '完讀日期範圍' : '最近完讀日期'}</span><strong>{range ? `${range.startedOn}～${range.completedOn}` : completion.date}</strong></div>}
      <details className="book-reading-details">
        <summary>閱讀明細</summary>
        <p>閱讀天數：{metrics.readingDays || '未記錄'} · 閱讀時間：{hasDuration ? formatDuration(metrics.totalMinutes) : '未記錄'}{metrics.readWords != null && metrics.readWords > 0 ? ` · 閱讀字數：${metrics.readWords.toLocaleString('zh-TW')} 字` : ''}</p>
        {days.length === 0 ? <p>尚無有日期的閱讀紀錄</p> : <ul>{days.map(day => <li key={day.date}><time dateTime={day.date}>{day.date}</time>{day.progress ? ` · ${readingProgressLabel(day.progress)}` : ''}{day.completed ? ' · 完讀' : ''}{day.minutes !== null ? ` · ${formatDuration(day.minutes)}` : ''}{day.words !== null ? ` · ${day.words.toLocaleString('zh-TW')} 字` : ''}</li>)}</ul>}
      </details>
    </>}
  </section>
}

