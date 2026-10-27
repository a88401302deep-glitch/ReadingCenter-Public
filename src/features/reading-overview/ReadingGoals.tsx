import { useState } from 'react'
import type { ReadingGoal } from '../../domain'
import type { ReadingStatisticsData } from './reading-statistics'
import { statisticsForPeriod } from './reading-statistics'
import type { ReadingOverviewService } from './reading-overview-service'

interface Props { data: ReadingStatisticsData; goals: ReadingGoal[]; service: ReadingOverviewService; onChanged: () => Promise<void> }
const hours = (minutes: number) => (minutes / 60).toLocaleString('zh-TW', { maximumFractionDigits: 2 })
export function ReadingGoals({ data, goals, service, onChanged }: Props) {
  const [month, setMonth] = useState(data.currentMonth)
  const [year, setYear] = useState(data.currentMonth.slice(0, 4))
  return <section className="content-section reading-goals" aria-label="閱讀目標">
    <h2>閱讀目標</h2>
    <p>月目標與年目標分別設定，以已記錄的閱讀時數計算；未記錄的時間不估算。</p>
    <div className="reading-goal-grid">
      <div><label>目標月份<input type="month" min="1000-01" max="9999-12" value={month} onChange={event => { if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value)) setMonth(event.target.value) }} /></label>
        <GoalCard key={month} period={month} label="月閱讀目標" {...{ data, goals, service, onChanged }} /></div>
      <div><label>目標年度<input type="number" min="1000" max="9999" value={year} onChange={event => setYear(event.target.value)} /></label>
        {/^[1-9]\d{3}$/.test(year) ? <GoalCard key={year} period={year} label="年閱讀目標" {...{ data, goals, service, onChanged }} /> : <p>請輸入 1000～9999 年。</p>}</div>
    </div>
  </section>
}
function GoalCard({ data, goals, service, onChanged, period, label }: Props & { period: string; label: string }) {
  const goal = goals.find(item => item.period === period)
  const statistics = statisticsForPeriod(data, period)
  const [draft, setDraft] = useState<{ hours: string; revision: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const target = goal?.targetMinutes ?? null
  const percentage = target ? Math.floor(statistics.minutes / target * 100) : null
  async function save(targetMinutes: number | null) {
    if (!draft) return
    setBusy(true); setError('')
    try { await service.saveGoal(period, targetMinutes, draft.revision); await onChanged(); setDraft(null) }
    catch (error) { setError(error instanceof Error ? error.message : '目標儲存失敗；輸入內容已保留') }
    finally { setBusy(false) }
  }
  return <section className="reading-goal-card" aria-label={`${period} ${label}`}>
    <h3>{label}</h3>
    <p>已記錄 {hours(statistics.minutes)} 小時{target !== null && `／目標 ${hours(target)} 小時`}</p>
    {target !== null ? <><progress aria-label={`${label}進度`} max={target} value={Math.min(statistics.minutes, target)} /><strong className="reading-goal-percentage">{percentage}%{statistics.minutes >= target && '，已達成'}</strong></> : <p>尚未設定目標</p>}
    {statistics.unknownRecords > 0 && <p>另有 {statistics.unknownRecords} 筆閱讀紀錄未記錄時長。</p>}
    {draft ? <form onSubmit={event => {
      event.preventDefault()
      const minutes = Number(draft.hours) * 60
      if (!draft.hours.trim() || !Number.isSafeInteger(Math.round(minutes)) || minutes <= 0 || Math.abs(minutes - Math.round(minutes)) > 1e-6) { setError('請輸入大於零的時數，精確至分鐘（例如 0.5 小時）'); return }
      void save(Math.round(minutes))
    }}>
      <label>{label}時數<input type="number" min="0.01" step="any" required disabled={busy} value={draft.hours} onChange={event => setDraft({ ...draft, hours: event.target.value })} /></label>
      {error && <p role="alert">{error}</p>}
      <div className="reading-goal-actions"><button type="submit" disabled={busy}>{busy ? '儲存中…' : '儲存目標'}</button><button type="button" disabled={busy} onClick={() => { setDraft(null); setError('') }}>取消</button>{target !== null && <button type="button" disabled={busy} onClick={() => void save(null)}>清除目標</button>}</div>
    </form> : <button type="button" onClick={() => { setDraft({ hours: target === null ? '' : String(target / 60), revision: goal?.revision ?? 0 }); setError('') }}>設定{label}</button>}
  </section>
}
