import { useState } from 'react'
import { getBookDisplayTitle, type Book } from '../../domain'
import type { ReadingTimelineData, TimelineEntry } from './reading-timeline'

function dayKey(date: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(date))
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-')
}
const timeLabel = (date: string) => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(date))
const progressLabel = (entry: Extract<TimelineEntry, { kind: 'record' }>) => {
  const progress = entry.record.progress
  return progress ? `進度 ${progress.value}${progress.unit === 'percent' ? '%' : progress.unit === 'page' ? ' 頁' : progress.unit === 'chapter' ? ' 章' : ''}` : null
}

export function ReadingTimeline({ data, onOpenBook }: { data: ReadingTimelineData; onOpenBook: (book: Book) => void }) {
  const [limit, setLimit] = useState(20)
  const groups = new Map<string, TimelineEntry[]>()
  for (const entry of data.entries.slice(0, limit)) {
    const day = dayKey(entry.date)
    const group = groups.get(day) ?? []
    group.push(entry); groups.set(day, group)
  }
  return <section className="content-section reading-timeline" aria-label="閱讀紀錄時間軸">
    <div className="section-heading"><h2>閱讀紀錄</h2><span className="count">{data.entries.length} 筆有日期紀錄</span></div>
    <p className="timeline-hint">由新到舊，按日期排列；閱讀紀錄與完讀事件分開列示，只有閱讀紀錄會計入閱讀時間。</p>
    {data.undatedCompletions > 0 && <p>另有 {data.undatedCompletions} 筆完讀日期未確定，未排入時間軸。</p>}
    {data.entries.length === 0 && <p className="empty-line">尚無有日期的閱讀紀錄</p>}
    {[...groups].map(([day, entries]) => <div className="timeline-day" key={day}>
      <h3><time dateTime={day}>{day}</time></h3>
      <ol>{entries.map(entry => <li key={entry.id}>
        <button type="button" onClick={() => onOpenBook(entry.book)}>
          <span className="timeline-event-type">{entry.kind === 'completion' || entry.kind === 'source-completion' ? '完讀' : '閱讀紀錄'}{entry.kind === 'completion' && entry.cycle.provenance.kind === 'import' ? ' · 匯入資料' : ''}</span>
          <strong>{getBookDisplayTitle(entry.book)}</strong>
          {entry.kind === 'record' ? <><time dateTime={entry.date}>{timeLabel(entry.date)}</time><span>{entry.durationMinutes === null ? '閱讀時間未記錄' : `${entry.durationMinutes} 分鐘`}</span>{progressLabel(entry) && <span>{progressLabel(entry)}</span>}</> : entry.kind === 'source' ? <><span>{entry.sourceDay.deviceId}</span><span>{Math.round(entry.durationMinutes)} 分鐘</span><span>{entry.sourceDay.readWords.toLocaleString('zh-TW')} 字 · {entry.sourceDay.progressPercent}%</span></> : entry.kind === 'source-completion' ? <><span>靜讀天下 100% · {entry.sourceDay.deviceId}</span><span>最早 100% 紀錄日</span></> : <>
            {entry.cycle.completionDate?.precision === 'range' ? <span>完讀區間：{entry.cycle.completionDate.startedOn}－{entry.cycle.completionDate.completedOn}（依區間末日排列）</span> : /^\d{4}-\d{2}-\d{2}$/.test(entry.date) ? <span>完讀日已知，時間未記錄</span> : <time dateTime={entry.date}>完讀時間 {timeLabel(entry.date)}</time>}
            <span>第 {entry.cycle.sequence} 次閱讀</span>{entry.cycle.reportedDurationMinutes != null && <span>整次閱讀累計 {entry.cycle.reportedDurationMinutes} 分鐘（每日分布未知）</span>}
          </>}
        </button>
      </li>)}</ol>
    </div>)}
    {limit < data.entries.length && <button type="button" onClick={() => setLimit(value => value + 20)}>載入較早的紀錄</button>}
  </section>
}

