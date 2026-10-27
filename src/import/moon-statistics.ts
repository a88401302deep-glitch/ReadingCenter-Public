/** Source aggregates, deliberately separate from timed ReadingRecord sessions. */
export interface MoonDay {
  dayCode: number
  durationMs: number
  readWords: number
  progressPercent: number
}
export interface MoonStatistic {
  path: string
  durationMs: number
  readWords: number
  days: MoonDay[]
}
export function parseMoonDays(value: string): MoonDay[] {
  const days: MoonDay[] = []
  const seen = new Set<number>()
  for (const line of value.split(/\r?\n/).filter(line => line.trim())) {
    const match = /^(\d+)\|(\d+)@(\d+) #([\d.]+)%$/.exec(line)
    if (!match) throw new Error('每日閱讀統計格式無法辨識')
    const numbers = match.slice(1).map(Number)
    const [dayCode, durationMs, readWords, progressPercent] = numbers
    if (numbers.some(n => !Number.isFinite(n)) || numbers.slice(0, 3).some(n => !Number.isSafeInteger(n)) || progressPercent < 0 || progressPercent > 100 || seen.has(dayCode)) throw new Error('每日統計數值或重複日碼需要核對')
    seen.add(dayCode)
    days.push({ dayCode, durationMs, readWords, progressPercent })
  }
  return days
}
export function combineMoonStatistics(snapshots: { deviceId: string; statistics: MoonStatistic[] }[]) {
  const records = new Map<string, { deviceId: string; path: string; day: MoonDay }>()
  const conflicts = new Set<string>()
  let duplicateDays = 0
  for (const snapshot of snapshots) {
    if (!snapshot.deviceId.trim()) throw new Error('請指定來源裝置')
    for (const statistic of snapshot.statistics) for (const day of statistic.days) {
      // Full source path is required: basenames can collide within one device.
      const key = JSON.stringify([snapshot.deviceId, statistic.path, day.dayCode])
      const previous = records.get(key)
      if (!previous) records.set(key, { deviceId: snapshot.deviceId, path: statistic.path, day })
      else if (previous.day.durationMs === day.durationMs && previous.day.readWords === day.readWords && previous.day.progressPercent === day.progressPercent) duplicateDays++
      else conflicts.add(key)
    }
  }
  const values = [...records.entries()].filter(([key]) => !conflicts.has(key)).map(([, row]) => row)
  return {
    records: values, duplicateDays, conflictCount: conflicts.size,
    durationMs: conflicts.size ? null : values.reduce((sum, r) => sum + r.day.durationMs, 0),
    readWords: conflicts.size ? null : values.reduce((sum, r) => sum + r.day.readWords, 0)
  }
}
