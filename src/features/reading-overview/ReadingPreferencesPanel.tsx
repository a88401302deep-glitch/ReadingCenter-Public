import { useEffect, useState } from 'react'
import type { ReadingPreferences } from '../../domain'
import { Button } from '../../shared/ui/Button'
import { MonthColorSettings } from './MonthColorSettings'
import type { ReadingOverviewService } from './reading-overview-service'

export function ReadingPreferencesPanel({ service, revision, onBack }: { service: ReadingOverviewService; revision: number; onBack: () => void }) {
  const [value, setValue] = useState<ReadingPreferences | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    void service.getPreferences().then(preferences => {
      if (!cancelled) { setValue(preferences); setLoaded(true); setError('') }
    }).catch(() => { if (!cancelled) setError('無法載入月份配色，請返回管理後重試') })
    return () => { cancelled = true }
  }, [service, revision])
  return <section className="content-section reading-preferences" aria-label="閱讀偏好設定">
    <Button onClick={onBack}>返回管理</Button>
    <h2>月份配色</h2>
    <p>每個月份的顏色用於閱讀月曆、年度圖表與全年熱力圖；首頁的統計線條跟隨當月。熱力圖的深淺代表當日完讀本數。</p>
    {error && <p role="alert">{error}</p>}
    {loaded ? <MonthColorSettings value={value} onSave={async (colors, expectedRevision) => setValue(await service.saveColors(colors, expectedRevision))} /> : !error && <p role="status">正在載入配色…</p>}
  </section>
}
