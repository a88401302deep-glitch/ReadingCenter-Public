import { useEffect, useState } from 'react'
import type { ReadingOverview, ReadingOverviewService } from './reading-overview-service'
export function HeaderReadingSummary({ service, revision }: { service: ReadingOverviewService; revision: number }) {
 const [overview, setOverview] = useState<ReadingOverview | null>(null)
 useEffect(() => { let live = true; void service.getOverview().then(value => { if (live) setOverview(value) }).catch(() => {}); return () => { live = false } }, [service, revision])
 const completed = Object.values(overview?.byBook ?? {}).filter(item => item.completedBookCount > 0).length
 const count = overview?.metrics.bookCount
 return <div className="header-reading-data" aria-label={overview ? `累計讀完 ${completed} 本，書庫總數 ${count} 本` : '正在載入書庫數據'}>
  <span>讀完</span><strong>{overview ? completed.toLocaleString('zh-TW') : '—'}<span className="header-data-separator" aria-hidden="true">／</span>{count?.toLocaleString('zh-TW') ?? '—'}</strong><span>本</span>
 </div>
}
