import { useCallback, useEffect, useRef, useState } from 'react'
import { NotionIntegrityAudit } from '../import/NotionIntegrityAudit'
import { NotionMediaBackfill } from '../import/NotionMediaBackfill'
import { NotionCompletionBackfill } from '../import/NotionCompletionBackfill'
import { NotionAuthorBackfill } from '../import/NotionAuthorBackfill'
import type { SyncingLocalRepositoryContext, SyncReviewArchive, SyncReviewChoice, SyncReviewItem, SyncableEntity } from '../../data'
import { CloudflareEntityClient, RemoteApiError, RemoteNetworkError, RemoteProtocolError } from '../../sync/cloudflare'
import { canKeepLocal, StaleSyncReviewError, SyncReviewService } from '../../sync/cloudflare/sync-review-service'
import { fingerprint } from '../../sync/cloudflare/cache'
import { Button } from '../../shared/ui/Button'
import './sync.css'

const kindLabels = { sourceReadingDay: '來源每日統計', work: '作品', activityLog: '活動紀錄', book: '書籍', readingCycle: '閱讀週期',
  readingRecord: '閱讀紀錄', readingContent: '閱讀內容', dictionary: '字典項目', collection: '系列／期刊', readingGoal: '閱讀目標', readingPreferences: '閱讀配色設定' }
const reasonLabels = { conflict: '同步衝突', 'local-only': '僅存於本機', different: '版本內容不同', unverified: '既有資料待核對' }
const fieldLabels: Record<string, string> = {
  id: '識別碼', title: '來源書名／標題', preferredTitle: '偏好顯示書名', subtitle: '副標題', originalTitle: '原文書名',
  languageTag: '語言', titleAliases: '別名', externalReferences: '外部來源', publicationKind: '出版類型',
  collectionId: '系列／期刊', sequence: '次序／冊期', serialization: '連載資料', isbn: 'ISBN', publishedOn: '出版日期',
  authorIds: '作者', publisherId: '出版社', mediaTypeId: '媒體類型', mediaType: '媒體類型', creatorIds: '創作者',
  categoryIds: '分類', tagIds: '標籤', sourceIds: '來源', cover: '封面', rating: '評分', bookNote: '書籍備註', importSourceNotes: '匯入來源資料', note: '備註',
  bookId: '所屬書籍', workId: '所屬作品', cycleId: '所屬閱讀週期', readingRecordId: '所屬閱讀紀錄',
  startedAt: '開始時間', endedAt: '結束時間', finishedAt: '完讀時間', recordedForAt: '內容對應日期',
  completionDate: '完讀日期與精度', reportedReadingDays: '來源回報天數', status: '狀態', abandonedReason: '棄讀原因',
  monthColors: '月份配色', period: '目標期間', targetMinutes: '目標分鐘', durationMinutes: '分鐘', progress: '進度', progressBefore: '開始進度', progressAfter: '結束進度',
  activityType: '活動類型', deviceId: '裝置', sourceId: '來源', type: '內容類型', text: '內容', locator: '位置',
  name: '名稱', kind: '類型', color: '顏色', aliases: '別名', typeMetadata: '作品細節',
  revision: '版本', createdAt: '建立時間', updatedAt: '更新時間', provenance: '資料來源'
}
const valueLabels: Record<string, string> = { manual: '人工', import: '匯入', reading: '閱讀中', planned: '預計閱讀',
  completed: '已完成', paused: '暫停', abandoned: '已棄讀', read: '閱讀', watch: '觀看',
  highlight: '畫線', shortReview: '短評', longReview: '長篇心得', ebook: '電子書', published: '出版品' }

function reviewError(reason: unknown): string {
  if (reason instanceof RemoteNetworkError) return '無法連線；核對決定尚未儲存，請連線後重試'
  if (reason instanceof RemoteApiError && reason.status === 401) return '登入已失效，請重新登入後核對'
  if (reason instanceof RemoteProtocolError) return '遠端資料格式不符，尚未變更本機資料'
  if (reason instanceof Error && /[\u3400-\u9fff]/.test(reason.message)) return reason.message
  return '無法儲存核對決定；原本資料已保留，請稍後重試'
}

function reviewTitle(item: Pick<SyncReviewItem, 'local' | 'remote' | 'entityId'>): string {
  const entity = (item.local ?? item.remote?.payload) as unknown as Record<string, unknown> | undefined
  if (entity && 'monthColors' in entity) return '12 個月份配色'
  if (typeof entity?.period === 'string' && 'targetMinutes' in entity) return `${entity.period} 閱讀目標`
  return String(entity?.preferredTitle || entity?.title || entity?.name || entity?.text || item.entityId).slice(0, 100)
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未設定'
  if (typeof value === 'string') return valueLabels[value] ?? value
  if (Array.isArray(value)) return value.length ? value.map(formatValue).join('、') : '未設定'
  if (typeof value === 'object') return Object.entries(value).map(([key, entry]) => `${fieldLabels[key] ?? key}：${formatValue(entry)}`).join('\n')
  return String(value)
}

function Comparison({ local, remote }: { local: SyncableEntity | null; remote: SyncReviewItem['remote'] }) {
  const left = local as unknown as Record<string, unknown> | null
  const right = remote?.payload as unknown as Record<string, unknown> | null
  const fields = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].filter((field) => field !== 'schemaVersion')
  return <div className="sync-comparison"><table><caption>本機與遠端內容比較</caption><thead><tr><th scope="col">欄位</th><th scope="col">本機</th><th scope="col">遠端</th></tr></thead><tbody>
    <tr><th scope="row">資料狀態</th><td>{local ? '保留資料' : '本機已刪除'}</td><td>{!remote ? '遠端沒有此資料' : remote.deletedAt ? '遠端已刪除' : '保留資料'}</td></tr>
    {fields.map((field) => <tr className={fingerprint(left?.[field] ?? null) !== fingerprint(right?.[field] ?? null) ? 'sync-field-different' : undefined} key={field}><th scope="row">{fieldLabels[field] ?? field}</th><td>{left ? formatValue(left[field]) : '—'}</td><td>{right ? formatValue(right[field]) : '—'}</td></tr>)}
  </tbody></table></div>
}

export function SyncManager({ local, message, syncing, onRetry, onResolved, onBack }: {
  local: SyncingLocalRepositoryContext | null; message: string; syncing: boolean
  onRetry: () => void; onResolved: () => void; onBack: () => void
}) {
  const service = useRef<SyncReviewService | null>(null)
  const request = useRef(0)
  const [items, setItems] = useState<SyncReviewItem[]>([])
  const [archives, setArchives] = useState<SyncReviewArchive[]>([])
  const [selected, setSelected] = useState<SyncReviewItem | null>(null)
  const [choice, setChoice] = useState<SyncReviewChoice | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [stale, setStale] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!service.current) return
    const current = ++request.current
    setLoading(true); setError(null); setSelected(null); setChoice(null); setStale(false); setAcknowledged(false)
    try {
      const [reviews, history] = await Promise.all([service.current.list(), service.current.archives()])
      if (current === request.current) { setItems(reviews); setArchives(history) }
    } catch { if (current === request.current) setError('無法載入核對資料；請確認登入與網路後重試，資料尚未變更') }
    finally { if (current === request.current) setLoading(false) }
  }, [])

  useEffect(() => {
    if (!local) return
    const controller = new AbortController()
    service.current = new SyncReviewService(local, new CloudflareEntityClient('', fetch, controller.signal), undefined, undefined, controller.signal)
    void reload()
    return () => { request.current += 1; controller.abort(); service.current = null }
  }, [local, reload])

  const apply = async () => {
    if (!selected || !choice || !acknowledged || stale || !service.current) return
    const current = request.current
    setApplying(true); setError(null)
    try {
      await service.current.resolve(selected, choice)
      if (current === request.current) {
        setNotice('已儲存核對決定，原本內容已留存副本；本機選擇仍須同步成功才會更新遠端。')
        onResolved()
        setApplying(false)
        await reload()
      }
    } catch (reason) {
      if (current === request.current) {
        setError(reviewError(reason))
        setStale(reason instanceof StaleSyncReviewError)
      }
    } finally { if (current === request.current && service.current) setApplying(false) }
  }

  const exportCopies = () => {
    const blob = new Blob([JSON.stringify({ formatVersion: 1, generatedAt: new Date().toISOString(), archives }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = 'readingcenter-sync-review-copies.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const localLabel = selected?.local ? '採用本機版本並同步' : selected?.remote?.payload ? '確認本機刪除並同步至遠端' : '保留刪除結果'
  const remoteLabel = selected?.remote?.payload ? '採用遠端版本' : '採用遠端結果，從本機移除'

  return <section className="sync-manager" aria-label="同步管理"><h2>同步</h2>
    <section className="sync-onedrive" aria-label="OneDrive 連線">
      <h3>靜讀天下備份</h3>
      <p>連結 OneDrive，授權閱讀中心讀取你的 Moon+ 備份資料。</p>
      <Button onClick={() => window.location.assign('/api/v1/onedrive/connect')}>連結 Microsoft OneDrive</Button>
    </section>
    <p>{local ? message : '本機模式尚未啟用雲端同步。'}</p>
    <div className="sync-actions">{local && <><Button disabled={syncing || applying} onClick={onRetry}>立即同步</Button><Button disabled={loading || applying} onClick={() => void reload()}>重新載入核對</Button></>}<Button disabled={applying} onClick={onBack}>返回管理</Button></div>
    {local && <><NotionIntegrityAudit /><NotionMediaBackfill onUpdated={onResolved} /><NotionCompletionBackfill onUpdated={onResolved} /><NotionAuthorBackfill onUpdated={onResolved} /><p>逐筆核對後再選擇；尚未確認的資料會繼續保留。被取代的內容留存在此裝置，可匯出保留副本。</p>
      {error && <p role="alert">{error}</p>}{notice && <p>{notice}</p>}
      {loading ? <p>正在載入待核對資料…</p> : <><h3>待核對項目（{items.length}）</h3>{items.length === 0 && !error ? <p>目前沒有待核對項目。</p> : <ul className="sync-review-list">{items.map((item) => <li key={item.key}><div><strong>{reviewTitle(item)}</strong><small>{kindLabels[item.kind]} · {reasonLabels[item.reason]} · {item.pending.length} 筆待同步修改</small></div><Button disabled={applying} onClick={() => { setSelected(item); setChoice(null); setAcknowledged(false); setStale(false); setError(null); setNotice(null) }}>核對</Button></li>)}</ul>}</>}
      {selected && <article className="sync-review-detail" aria-label="逐筆同步核對"><h3>{reviewTitle(selected)}</h3><p>{kindLabels[selected.kind]} · {reasonLabels[selected.reason]}</p><Comparison local={selected.local} remote={selected.remote} />
        {!canKeepLocal(selected) && <p>遠端資料由人工維護，匯入內容不能覆蓋；請採用遠端版本。</p>}
        <fieldset disabled={applying || stale}><legend>選擇此次核對結果</legend><label><input type="radio" name="sync-choice" checked={choice === 'local'} disabled={!canKeepLocal(selected)} onChange={() => { setChoice('local'); setAcknowledged(false) }} />{localLabel}</label><label><input type="radio" name="sync-choice" checked={choice === 'remote'} onChange={() => { setChoice('remote'); setAcknowledged(false) }} />{remoteLabel}</label></fieldset>
        {choice && <p>{choice === 'local' ? `${localLabel}；若遠端再有新版本，將再次停下核對。` : `${remoteLabel}；這筆本機待同步修改會取消。`}兩方原始內容都會留存副本。</p>}
        <label className="sync-acknowledge"><input type="checkbox" checked={acknowledged} disabled={!choice || applying || stale} onChange={(event) => setAcknowledged(event.target.checked)} />我已核對兩方內容，確認採用所選結果</label>
        <div className="sync-actions"><Button variant="primary" disabled={!choice || !acknowledged || applying || stale} onClick={() => void apply()}>確認此筆結果</Button><Button disabled={applying} onClick={() => setSelected(null)}>暫不處理</Button></div>
      </article>}
      <details><summary>已核對的保留副本（{archives.length}）</summary><Button disabled={!archives.length} onClick={exportCopies}>匯出核對保留副本</Button>{archives.map((entry) => <details key={entry.id}><summary>{reviewTitle(entry.review)} · {entry.choice === 'local' ? '採用本機' : '採用遠端'} · {new Date(entry.resolvedAt).toLocaleString('zh-TW')}</summary><Comparison local={entry.review.local} remote={entry.review.remote} /></details>)}</details>
    </>}
  </section>
}

