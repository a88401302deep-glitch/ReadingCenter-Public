import { useState } from 'react'
import { defaultMonthColors, readingMonthColors, type ReadingPreferences } from '../../domain'
interface Props { value?: ReadingPreferences | null; onSave: (colors: string[], expectedRevision: number) => Promise<void> }
export function MonthColorSettings({ value, onSave }: Props) {
  const [draft, setDraft] = useState<{ colors: string[]; revision: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return <section className="reading-color-settings" aria-label="月份配色設定">
    {!draft ? <button type="button" onClick={() => { setDraft({ colors: [...readingMonthColors(value)], revision: value?.revision ?? 0 }); setError('') }}>編輯月份配色</button> : <form onSubmit={event => {
      event.preventDefault(); setBusy(true); setError('')
      void onSave(draft.colors, draft.revision).then(() => setDraft(null)).catch(error => setError(error instanceof Error ? error.message : '配色儲存失敗；選色已保留')).finally(() => setBusy(false))
    }}>
      <h3>12 個月份配色</h3><p>儲存後套用到首頁、月曆與全年圖表，並隨資料同步。「還原預設色」也需再按儲存。</p>
      <div className="reading-color-grid">{draft.colors.map((color, index) => <label key={index}>{index + 1} 月<input type="color" aria-label={`${index + 1} 月配色`} disabled={busy} value={color} onChange={event => setDraft({ ...draft, colors: draft.colors.map((current, at) => at === index ? event.target.value : current) })} /></label>)}</div>
      {error && <p role="alert">{error}</p>}
      <div className="reading-color-actions"><button type="submit" disabled={busy}>{busy ? '儲存中…' : '儲存配色'}</button><button type="button" disabled={busy} onClick={() => setDraft({ ...draft, colors: [...defaultMonthColors] })}>還原預設色</button><button type="button" disabled={busy} onClick={() => { setDraft(null); setError('') }}>取消配色編輯</button></div>
    </form>}
  </section>
}
