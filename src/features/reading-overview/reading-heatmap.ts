import type { ReadingDay, ReadingStatisticsData } from './reading-statistics'
export interface HeatmapDay { date: string; day?: ReadingDay }
export const heatmapStrengths = [0, 35, 55, 75, 100] as const
export function completedOnDay(day?: ReadingDay): number { return new Set(day?.entries.filter(entry => (entry.kind === 'completion' || entry.kind === 'source-completion')).map(entry => entry.book.id)).size }
export function heatmapLevel(count: number): number { return Math.min(4, Math.max(0, Math.floor(count))) }
export function heatmapDescription(day?: ReadingDay): string {
  const count = completedOnDay(day)
  return `完讀 ${count} 本${!count && (day?.entries.length || day?.sourceDays?.length) ? '，有閱讀紀錄' : ''}`
}
export function buildYearHeatmap(data: ReadingStatisticsData, year: number): { weeks: (HeatmapDay | null)[][]; days: HeatmapDay[]; monthWeeks: number[] } {
  if (!Number.isInteger(year) || year < 1000 || year > 9999) throw new Error('熱力圖年度無效')
  const byDate = new Map(data.days.map(day => [day.date, day]))
  const start = Date.UTC(year, 0, 1), end = Date.UTC(year + 1, 0, 1)
  const offset = (new Date(start).getUTCDay() + 6) % 7
  const days: HeatmapDay[] = []
  const cells: (HeatmapDay | null)[] = Array.from({ length: offset }, () => null)
  const monthWeeks: number[] = []
  for (let time = start; time < end; time += 86400000) {
    const date = new Date(time).toISOString().slice(0, 10)
    if (date.endsWith('-01')) monthWeeks.push(Math.floor(cells.length / 7))
    const value = { date, day: byDate.get(date) }
    days.push(value); cells.push(value)
  }
  while (cells.length % 7) cells.push(null)
  return { days, monthWeeks, weeks: Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7)) }
}

// Choose the higher-contrast black/white foreground against the warm surface mix.
export function heatmapTextColor(color: string, strength: number): string {
  const surface = [250, 248, 243]
  const channels = [1, 3, 5].map((start, index) => (parseInt(color.slice(start, start + 2), 16) * strength / 100 + surface[index] * (1 - strength / 100)) / 255)
  const linear = channels.map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  const luminance = linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722
  return (luminance + .05) / .05 >= 1.05 / (luminance + .05) ? '#000000' : '#ffffff'
}



