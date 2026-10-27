import { useEffect, useMemo, useState } from 'react'
import { liveQuery } from 'dexie'
import { createSyncingIndexedDbRepositories } from '../../data'
import { CloudflareSyncSession, LocalReconciliationRequiredError, type SessionSyncResult } from '../../sync/cloudflare/sync-session'
import { CloudflareEntityClient, RemoteApiError, RemoteNetworkError } from '../../sync/cloudflare'
import { withCloudSyncLock } from '../../sync/cloudflare/sync-lock'

export function syncMessage(result: SessionSyncResult): string {
  if (result.conflicts) return `有 ${result.conflicts} 筆同步衝突，已保留本機與遠端版本，待核對後才能繼續送出。`
  if (result.error instanceof RemoteApiError && result.error.status === 401) return '登入已失效，請重新登入；待同步資料仍保留在此裝置。'
  if (result.error instanceof RemoteNetworkError) return '無法連線；修改已保留在此裝置，網路恢復後會重試。'
  if (result.error instanceof LocalReconciliationRequiredError) return '既有本機資料尚未與遠端核對；修改已保留，暫停送出以免覆寫。'
  if (result.error) return '同步暫停；本機資料與待同步修改已保留，請稍後重試。'
  if (result.preserved) return `已更新遠端資料；此裝置另有 ${result.preserved} 筆既有資料待核對，尚未送出或覆寫。`
  if (result.pending) return `尚有 ${result.pending} 筆修改待同步。`
  return '已同步。'
}

export function useCloudSync(enabled: boolean, remoteEnabled = enabled) {
  const local = useMemo(() => enabled ? createSyncingIndexedDbRepositories() : null, [enabled])
  const [message, setMessage] = useState('正在準備同步…')
  const [revision, setRevision] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    if (!local || !remoteEnabled) return
    const controller = new AbortController()
    const session = new CloudflareSyncSession(local, new CloudflareEntityClient('', fetch, controller.signal))
    let disposed = false
    let active = false
    let rerun = false
    let blocked = false
    const run = async (explicit = false) => {
      if (disposed || (blocked && !explicit)) return
      if (active) { rerun = true; return }
      active = true
      setSyncing(true)
      try {
        // Other tabs share the same database and must not send the same queue in parallel.
        const perform = () => session.sync()
        const result = await withCloudSyncLock(perform, controller.signal)
        if (!disposed) {
          blocked = result.status === 'stopped'
          setMessage(syncMessage(result))
          setRevision((value) => value + 1)
        }
      } catch {
        blocked = true
        if (!disposed) setMessage('無法讀取本機同步資料；請保留此裝置資料並稍後重試。')
      } finally {
        active = false
        if (!disposed) setSyncing(false)
        if (rerun && !disposed) { rerun = false; void run() }
      }
    }
    let previousIds: Set<string> | null = null
    const subscription = liveQuery(() => local.outbox.getAll()).subscribe({
      next: (entries) => {
        const ids = new Set(entries.map((entry) => entry.mutationId))
        const added = previousIds === null || entries.some((entry) => !previousIds!.has(entry.mutationId))
        previousIds = ids
        if (added) void run()
      },
      error: () => { if (!disposed) setMessage('無法讀取待同步資料；請保留此裝置資料並稍後重試。') }
    })
    // Also runs on an explicit retry; liveQuery's initial emission coalesces with this.
    void run(true)
    return () => {
      disposed = true
      controller.abort()
      subscription.unsubscribe()
    }
  }, [local, remoteEnabled, retry])

  return { local, repositories: local?.repositories, message: remoteEnabled ? message : '目前使用離線副本；修改保留在此裝置，連線驗證成功後才同步。', revision, syncing: remoteEnabled && syncing,
    retry: () => setRetry((value) => value + 1),
    onResolved: () => { setRevision((value) => value + 1); setRetry((value) => value + 1) } }
}
