import type { ReadingContent, ReadingCycle } from '../../domain'

const formatTime = (value: string) => new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))

export function ReadingContentDate({ content, cycles = [] }: { content: ReadingContent; cycles?: ReadingCycle[] }) {
  if (content.recordedForAt) return <time dateTime={content.recordedForAt}>{formatTime(content.recordedForAt)}</time>
  if (content.provenance.kind !== 'import') return <time dateTime={content.createdAt}>{formatTime(content.createdAt)}</time>
  if (content.type !== 'shortReview' || content.provenance.sourceId !== 'notion-csv-snapshot') return <span>原始日期未提供</span>

  const bookCycles = cycles.filter((cycle) => cycle.bookId === content.bookId)
  const provenance = content.provenance
  const sourceRow = provenance.externalId.replace(/:short-review$/, '')
  const sourceCycles = bookCycles.filter((cycle) => cycle.provenance.kind === 'import' && cycle.provenance.sourceId === provenance.sourceId && cycle.provenance.externalId === sourceRow)
  const cycle = content.cycleId ? bookCycles.find((item) => item.id === content.cycleId)
    : sourceCycles.length === 1 ? sourceCycles[0] : sourceCycles.length === 0 && bookCycles.length === 1 ? bookCycles[0] : undefined
  if (!cycle || cycle.status !== 'completed') return <span>完讀日期未確定</span>
  const date = cycle.completionDate
  if (date?.precision === 'range') return <span>完讀日期範圍：{date.startedOn}－{date.completedOn}</span>
  if (date) return <span>完讀日：<time dateTime={date.completedOn}>{date.completedOn}</time></span>
  return cycle.finishedAt ? <span>完讀日：<time dateTime={cycle.finishedAt}>{formatTime(cycle.finishedAt)}</time></span> : <span>完讀日期未確定</span>
}
