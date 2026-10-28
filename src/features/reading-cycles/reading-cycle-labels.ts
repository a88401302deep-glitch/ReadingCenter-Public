import type { ReadingCycle, ReadingCycleStatus } from '../../domain'
export const statusLabel: Record<ReadingCycleStatus, string> = { planned: '預計閱讀', reading: '閱讀中', paused: '暫停', completed: '已讀完', abandoned: '已棄讀' }
export const cycleDateLabel = (cycle: ReadingCycle) => {
  const date = cycle.completionDate
  if (date) {
    if (date.precision === 'range') return `完讀日期範圍：${date.startedOn}－${date.completedOn}`
    if (date.precision === 'minute') {
      const offset = Math.abs(date.offsetMinutes)
      const zone = `UTC${date.offsetMinutes >= 0 ? '+' : '-'}${String(Math.floor(offset / 60)).padStart(2, '0')}:${String(offset % 60).padStart(2, '0')}`
      return `完讀：${date.completedOn} ${date.localTime}（${zone}）`
    }
    return `完讀：${date.completedOn}`
  }
  if (cycle.startedAt) return `${cycle.startedAt.slice(0, 10)}${cycle.finishedAt ? `－${cycle.finishedAt.slice(0, 10)}` : ''}`
  return cycle.finishedAt ? `結束：${cycle.finishedAt.slice(0, 10)}` : '日期未設定'
}
