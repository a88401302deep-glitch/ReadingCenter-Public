import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/auth-context'
import { Button, Popover } from '../../shared/ui'
import { statisticsForPeriod } from './reading-statistics'
import type { ReadingOverview, ReadingOverviewService } from './reading-overview-service'

export function ReadingOverviewCard({ overview, service, onChanged }: { overview: ReadingOverview | null; service: ReadingOverviewService; onChanged: () => Promise<void> }) {
  const { previewReadOnly } = useAuth()
  const year = overview?.statistics?.currentMonth.slice(0, 4) ?? new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: 'Asia/Taipei' }).format(new Date())
  const goal = overview?.goals?.find(item => item.period === year)
  const target = goal?.targetBooks ?? 70
  const completed = overview?.statistics ? statisticsForPeriod(overview.statistics, year).completedBooks : 0
  const total = overview?.statistics ? statisticsForPeriod(overview.statistics, '') : null
  const percent = Math.round(completed / target * 100)
  const minutes = Math.floor(total?.minutes ?? 0)
  const duration = total?.knownRecords ? minutes < 60 ? `${minutes} 分鐘` : `${Math.floor(minutes / 60)} 小時` : '—'
  const words = overview?.sourceTotals?.rows ? overview.sourceTotals.readWords : null
  const wordLabel = words === null ? '—' : words >= 10000 ? `${(words / 10000).toLocaleString('zh-TW', { maximumFractionDigits: 1 })} 萬` : words.toLocaleString('zh-TW')
  const [draft, setDraft] = useState('')
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('')
    try { await service.saveBookGoal(year, Number(draft), goal?.revision ?? 0); await onChanged(); setSaved(true) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '無法儲存年度目標') }
    finally { setBusy(false) }
  }
  return <section className="reading-overview-card" aria-label="閱讀統計" aria-busy={!overview}>
    <div className="annual-reading-heading">
      <h2><span>{year} 年完讀</span><strong>{overview ? completed : '—'} <small>/ {target} 本</small></strong></h2>
      <Popover label="年度完讀目標" trigger={props => <Button variant="ghost" size="small" disabled={!overview || previewReadOnly} {...props} onClick={() => { setDraft(String(target)); setSaved(false); setError(''); props.onClick() }}>調整目標</Button>} content={saved ? <p role="status">已更新為 {target} 本</p> : <form className="annual-goal-form" onSubmit={submit}><label>年度目標本數<input aria-label="年度目標本數" required type="number" min="1" max={100000} step="1" value={draft} onChange={event => setDraft(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<Button disabled={busy || previewReadOnly} variant="primary" type="submit">儲存目標</Button></form>} />
    </div>
    <div className="annual-reading-progress"><progress aria-label="年度完讀進度" max={target} value={overview ? Math.min(completed, target) : 0} /><span>{overview ? `${percent}%` : '—'}</span></div>
    <section className="reading-card-metrics" aria-label="閱讀補充摘要">
      <div><span>本月完讀</span><strong>{overview ? overview.metrics.completedBookCount : '—'}<small> 本</small></strong></div>
      <div title={total?.knownRecords ? `已記錄 ${minutes.toLocaleString('zh-TW')} 分鐘` : '尚無時長紀錄'}><span>閱讀時數</span><strong>{duration}</strong></div>
      <div title={words === null ? '尚無閱讀字數紀錄' : `${words.toLocaleString('zh-TW')} 字`}><span>總字數</span><strong>{wordLabel}</strong></div>
    </section>
  </section>
}
