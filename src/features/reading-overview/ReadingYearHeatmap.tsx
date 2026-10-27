import { useRef, useState, type CSSProperties } from 'react'
import { buildYearHeatmap, completedOnDay, heatmapDescription, heatmapLevel, heatmapStrengths, type HeatmapDay } from './reading-heatmap'
import type { ReadingStatisticsData } from './reading-statistics'
interface Props { data: ReadingStatisticsData; year: number; month: string; colors: readonly string[]; selectedDate: string | null; onSelectDate: (date: string) => void; onSelectMonth: (month: string) => void }
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
export function ReadingYearHeatmap({ data, year, colors, selectedDate, onSelectDate }: Props) {
  const { days, weeks, monthWeeks } = buildYearHeatmap(data, year)
  const [focusDate, setFocusDate] = useState(`${year}-01-01`)
  const grid = useRef<HTMLDivElement>(null)
  const cell = (value: HeatmapDay) => <button type="button" key={value.date} data-date={value.date} tabIndex={focusDate === value.date ? 0 : -1} className={`reading-heatmap-day${completedOnDay(value.day) ? ' has-completions' : ''}`} aria-label={`${value.date}，${heatmapDescription(value.day)}`} title={`${value.date}，${heatmapDescription(value.day)}`} aria-pressed={selectedDate === value.date} style={{ '--heatmap-color': colors[Number(value.date.slice(5, 7)) - 1], '--heatmap-strength': heatmapStrengths[heatmapLevel(completedOnDay(value.day))] } as CSSProperties} onFocus={() => setFocusDate(value.date)} onClick={() => onSelectDate(value.date)} />
  return <section className="reading-year-heatmap" aria-label={`${year} 年閱讀熱力圖`}>
    <div className="section-heading"><h3>全年完讀熱力圖</h3><span className="count">{year}</span></div>
    <div className="overview-heatmap-scroll" tabIndex={0} role="group" aria-label={`${year} 年全年日期格`} ref={grid} onKeyDown={event => {
      if (!(event.target instanceof HTMLButtonElement)) return
      const delta = ({ ArrowLeft: -7, ArrowRight: 7, ArrowUp: -1, ArrowDown: 1 } as Record<string, number>)[event.key]
      if (delta === undefined) return
      event.preventDefault()
      const index = days.findIndex(day => day.date === focusDate)
      const next = days[Math.min(days.length - 1, Math.max(0, index + delta))].date
      setFocusDate(next); grid.current?.querySelector<HTMLButtonElement>(`button[data-date="${next}"]`)?.focus()
    }}>
      <div className="overview-heatmap-grid">
        <div className="reading-heatmap-month-labels" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>{monthWeeks.map((start, index) => <span key={index} style={{ gridColumn: `${start + 1} / ${(monthWeeks[index + 1] ?? weeks.length) + 1}`, borderTopColor: colors[index] }}>{index + 1}月</span>)}</div>
        <div className="reading-heatmap-matrix"><div className="reading-heatmap-weekdays">{weekdays.map(day => <span key={day}>{day}</span>)}</div><div className="reading-heatmap-weeks" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>{weeks.map((week, index) => <div className="reading-heatmap-week" key={index}>{week.map((day, at) => day ? cell(day) : <span className="reading-heatmap-padding" key={`padding-${at}`} />)}</div>)}</div></div>
      </div>
    </div>
    <div className="overview-heatmap-footer"><ul className="reading-heatmap-legend" aria-label="完讀本數色階">{['0 本', '1 本', '2 本', '3 本', '4 本以上'].map((label, index) => <li key={label}><span aria-hidden="true" style={{ '--heatmap-color': colors[0], '--heatmap-strength': heatmapStrengths[index] } as CSSProperties} />{label}</li>)}</ul><label>查看日期<input type="date" aria-label="熱力圖日期" min={`${year}-01-01`} max={`${year}-12-31`} value={selectedDate?.startsWith(`${year}-`) ? selectedDate : ''} onChange={event => { if (days.some(day => day.date === event.target.value)) onSelectDate(event.target.value) }} /></label></div>
    <p className="overview-mobile-hint">可左右滑動查看全年，或選日期查看書籍。</p>
  </section>
}
