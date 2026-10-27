import type { ReadingProgress } from '../../domain'
import { readingProgressLabel } from '../../features/reading-overview/book-reading-days'
export function BookProgress({ progress, quiet = false, completed = false }: { progress: ReadingProgress | null; quiet?: boolean; completed?: boolean }) {
 const percent = completed ? 100 : progress ? progress.unit === 'percent' ? progress.value : progress.total ? progress.value / progress.total * 100 : null : null
 const label = completed ? '已完讀' : percent === null ? progress ? readingProgressLabel(progress) : '閱讀中' : `${Number(percent.toFixed(2))}%`
 return <div className={`book-progress${quiet ? ' is-quiet' : ''}`}><progress aria-label={completed ? '已完讀' : '閱讀進度'} max={100} value={Math.min(100, Math.max(0, percent ?? 0))} />{!quiet && <span>{label}</span>}</div>
}
