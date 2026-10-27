import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { getBookDisplayTitle, readingMonthColors, type ReadingPreferences, type Book } from '../../domain'
import { BookCover } from '../../shared/ui'
import { categoryStatistics, statisticsForPeriod, type ReadingStatisticsData } from './reading-statistics'
import { ReadingYearHeatmap } from './ReadingYearHeatmap'
import { completedOnDay, heatmapLevel, heatmapStrengths, heatmapTextColor } from './reading-heatmap'
const distributionColors = ['#94a79d', '#afa1b3', '#c5ae8e', '#9aaab5', '#b99c92', '#a5ae92', '#a49d94', '#b9a7a2']
const weekdays = ['一', '二', '三', '四', '五', '六', '日']
const duration = (value: number) => { const minutes = Math.round(value); return minutes < 60 ? `${minutes} 分鐘` : `${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分` }
const shiftMonth = (month: string, delta: number) => { const [year, value] = month.split('-').map(Number); return new Date(Date.UTC(year, value - 1 + delta, 1)).toISOString().slice(0, 7) }
export function ReadingStatistics({ data, onOpenBook, preferences }: { data: ReadingStatisticsData; onOpenBook: (book: Book) => void; preferences?: ReadingPreferences | null }) {
  const colors = readingMonthColors(preferences)
  const selectedDay = useRef<HTMLElement>(null)
  const scrollToSelection = useRef(false)
  const [month, setMonth] = useState(data.currentMonth)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [year, monthNumber] = month.split('-').map(Number)
  const period = statisticsForPeriod(data, month), yearly = statisticsForPeriod(data, String(year))
  const months = Array.from({ length: 12 }, (_, index) => ({ month: `${year}-${String(index + 1).padStart(2, '0')}`, stats: statisticsForPeriod(data, `${year}-${String(index + 1).padStart(2, '0')}`) }))
  const max = Math.max(1, ...months.map(item => item.stats.completedBooks))
  const byDate = new Map(period.days.map(day => [day.date, day]))
  const selected = selectedDate?.startsWith(month) ? byDate.get(selectedDate) : undefined
  const selectedBooks = new Map((selected?.entries ?? []).map(entry => [entry.book.id, entry.book]))
  const color = colors[monthNumber - 1]
  const categories = categoryStatistics(data, yearly)
  const books = [...new Map(yearly.days.flatMap(day => day.entries).filter(entry => (entry.kind === 'completion' || entry.kind === 'source-completion')).map(entry => [entry.book.id, entry.book])).values()]
  const ratings = [5, 4, 3, 2, 1].map(star => ({ star, count: books.filter(book => book.rating && Math.ceil(book.rating.value / book.rating.scale * 5) === star).length }))
  const rated = ratings.reduce((sum, item) => sum + item.count, 0)
  const changeMonth = (value: string) => { if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(value)) { setMonth(value); setSelectedDate(null) } }
  const selectDate = (date: string) => { scrollToSelection.current = true; setMonth(date.slice(0, 7)); setSelectedDate(date); if (date === selectedDate) selectedDay.current?.scrollIntoView?.({ block: 'nearest' }) }
  useEffect(() => { if (scrollToSelection.current) { selectedDay.current?.scrollIntoView?.({ block: 'nearest' }); scrollToSelection.current = false } }, [month, selectedDate])
  return <section className="content-section reading-statistics overview-statistics" aria-label="閱讀統計與月曆" style={{ '--reading-month-color': color } as CSSProperties}>
    <div className="section-heading"><h2>每月完讀本數</h2></div>
    <p className="overview-year-total">{year} 年 · 完讀 {yearly.completedBooks} 本</p>
    <div className="overview-year-chart" role="group" aria-label={`${year} 年每月完讀本數`}>
      {months.map((item, index) => <button type="button" key={item.month} aria-label={`${item.month}，完讀 ${item.stats.completedBooks} 本`} aria-pressed={month === item.month} onClick={() => changeMonth(item.month)}><span className="overview-bar-track"><span className="overview-bar" style={{ height: `${item.stats.completedBooks / max * 100}%`, backgroundColor: colors[index] }}><span>{item.stats.completedBooks}</span></span></span><span>{index + 1}<span>月</span></span></button>)}
    </div>
    <section className="reading-history-card" aria-label="閱讀熱力圖與月曆">
    <div className="reading-history-heading"><div><h3>閱讀足跡</h3><p>全年完讀與每日閱讀，一起回顧。</p></div><div className="reading-statistics-navigation"><button type="button" aria-label="上個月" disabled={month === '1000-01'} onClick={() => changeMonth(shiftMonth(month, -1))}>‹</button><label><span className="sr-only">查看月份</span><input type="month" aria-label="統計月份" min="1000-01" max="9999-12" value={month} onChange={event => changeMonth(event.target.value)} /></label><button type="button" aria-label="下個月" disabled={month === '9999-12'} onClick={() => changeMonth(shiftMonth(month, 1))}>›</button></div></div>
    <ReadingYearHeatmap key={year} data={data} year={year} month={month} colors={colors} selectedDate={selectedDate} onSelectMonth={changeMonth} onSelectDate={selectDate} />
    {selectedDate?.startsWith(month) && <section ref={selectedDay} aria-label="所選日期書目" className="reading-selected-day"><h3>{selectedDate}</h3>{(selected?.sourceDays ?? []).map(row => <p key={row.id}>{row.sourceTitle} · {row.deviceId} · {duration(row.durationMs / 60000)} · {row.readWords.toLocaleString()} 字 · {row.progressPercent}%{row.completionDisputed ? '（完讀待核對）' : row.progressPercent === 100 ? '（來源 100%）' : ''}</p>)}{!selectedBooks.size ? (selected?.sourceDays?.length ? null : <p>這一天沒有閱讀紀錄或完讀資料。</p>) : <ul>{[...selectedBooks.values()].map(book => { const entries = selected!.entries.filter(entry => entry.book.id === book.id); return <li key={book.id}><button type="button" onClick={() => onOpenBook(book)}><BookCover src={book.cover?.path} title={getBookDisplayTitle(book)} /><span><strong>{getBookDisplayTitle(book)}</strong>{entries.map(entry => <span key={entry.id}>{entry.kind === 'source-completion' ? '完讀（靜讀天下 100%）' : entry.kind === 'completion' ? entry.cycle.completionDate?.precision === 'range' ? `完讀區間：${entry.cycle.completionDate.startedOn}～${entry.cycle.completionDate.completedOn}` : '完讀' : entry.durationMinutes === null ? '閱讀紀錄' : `閱讀紀錄：${duration(entry.durationMinutes)}`}</span>)}</span></button></li> })}</ul>}</section>}
    <div className="section-heading"><h3>閱讀月曆</h3><span>{month} · 完讀 {period.completedBooks} 本</span></div>
    <div className={`reading-calendar${period.days.some(day => day.entries.length > 0 || (day.sourceDays?.length ?? 0) > 0) ? '' : ' is-empty-month'}`} aria-label={`${month} 閱讀月曆`}>
      {weekdays.map(day => <span className="reading-calendar-weekday" key={day}>{day}</span>)}
      {Array.from({ length: (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7 }, (_, index) => <span key={`empty-${index}`} />)}
      {Array.from({ length: new Date(Date.UTC(year, monthNumber, 0)).getUTCDate() }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`, day = byDate.get(date)
        const dayBooks = new Map((day?.entries ?? []).map(entry => [entry.book.id, entry.book]))
        const count = completedOnDay(day), strength = heatmapStrengths[heatmapLevel(count)]
        return <button key={date} type="button" className={`reading-calendar-day${day ? ' has-reading-evidence' : ''}`} aria-label={`${date}，完讀 ${count} 本${(dayBooks.size || day?.sourceDays?.length) && !count ? '，有閱讀紀錄' : ''}`} aria-pressed={date === selectedDate} onClick={() => selectDate(date)} style={{ '--reading-day-strength': strength, color: heatmapTextColor(color, strength) } as CSSProperties}>
          <time dateTime={date}>{index + 1}</time><span className="reading-calendar-indicator">{count ? `${count} 本` : (dayBooks.size || day?.sourceDays?.length) ? '●' : ''}</span><span className="reading-calendar-covers">{[...dayBooks.values()].slice(0, 2).map(book => <span key={book.id}><BookCover src={book.cover?.path} title={getBookDisplayTitle(book)} /></span>)}</span>
        </button>
      })}
    </div>
    </section>
    <div className="overview-distributions"><section aria-label="年度閱讀分類"><h3>閱讀分類 <small>{year}{categories.length > 8 ? ' · 前 8 類' : ''}</small></h3><p className="overview-distribution-note">本年讀過 {yearly.readBooks} 本 · 可含多分類</p>{categories.length ? <ul className="overview-distribution-list">{categories.slice(0, 8).map((category, index) => <li key={category.id}><span>{category.name}</span><strong>{category.count} 本</strong><span className="overview-distribution-track"><span style={{ width: `${category.percentage}%`, backgroundColor: distributionColors[index % distributionColors.length] }} /></span></li>)}</ul> : <p className="overview-empty">尚無分類資料</p>}</section><section aria-label="年度評分分布"><h3>評分分布 <small>{year}</small></h3><p className="overview-distribution-note">本年完讀 · 已評分 {rated} 本 · 未評分 {books.length - rated} 本</p>{rated ? <ul className="overview-distribution-list">{ratings.map(item => <li key={item.star}><span>{item.star} 星</span><strong>{item.count} 本</strong><span className="overview-distribution-track"><span style={{ width: `${item.count / rated * 100}%`, backgroundColor: distributionColors[0] }} /></span></li>)}</ul> : <p className="overview-empty">尚無評分資料</p>}</section></div>
    <details className="overview-method"><summary>統計方式與每月明細</summary><p>以不重複書籍計算完讀本數；已配對且無爭議的靜讀天下 100% 也計入，有既有完讀紀錄時優先採用既有紀錄。來源日期採最早 100% 紀錄日，不推算重讀次數；同一本書多個分類不增加完讀總數。各月重讀可能重複出現，年度本數不直接相加月值。熱力圖按每日完讀本數；區間日期只列末日。分類按本年讀過書籍計算，可同時列入多類；10 分制評分換算 5 星，半星列入較高星級。</p>{data.undatedCompletions > 0 && <p>另有 {data.undatedCompletions} 次完讀缺少日期，保留在累計，不列入月／年圖表。</p>}<table className="reading-statistics-table"><thead><tr><th>月份</th><th>完讀本數</th></tr></thead><tbody>{months.map(item => <tr key={item.month}><th>{item.month}</th><td>{item.stats.completedBooks}</td></tr>)}</tbody></table></details>
  </section>
}



