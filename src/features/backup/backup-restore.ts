import type { ReadingCenterRepositories, SyncingLocalRepositoryContext, SyncableEntity, SyncEntityKind } from '../../data'
import { fingerprint, syncTables, validateRemote } from '../../sync/cloudflare/cache'
import { CloudflareEntityClient } from '../../sync/cloudflare/entity-client'
import { withCloudSyncLock } from '../../sync/cloudflare/sync-lock'
import { backupCollections, captureDeviceBackup, type BackupCollection, type DeviceBackup } from './backup-export'
import { relationWarnings, validateBackup, type VerifiedBackup } from './backup-preview'

export interface RestoreRow { key: string; collection: BackupCollection; id: string; title: string; status: 'new' | 'different'; current: SyncableEntity | null; incoming: SyncableEntity }
const content = (row: SyncableEntity) => Object.fromEntries(Object.entries(row).filter(([key]) => !['revision', 'createdAt', 'updatedAt', 'provenance'].includes(key)))
export function restoreRows(incoming: DeviceBackup, current: DeviceBackup): RestoreRow[] {
  return backupCollections.flatMap(collection => {
    const existing = new Map<string, SyncableEntity>(current.data[collection].map(row => [row.id, row]))
    return incoming.data[collection].flatMap(row => {
      const prior = existing.get(row.id)
      if (prior && fingerprint(content(prior)) === fingerprint(content(row))) return []
      const title = 'title' in row ? row.title : 'name' in row ? row.name : 'sourceTitle' in row ? row.sourceTitle : row.id
      return [{ key: `${collection}:${row.id}`, collection, id: row.id, title: title || row.id, status: prior ? 'different' as const : 'new' as const, current: prior ?? null, incoming: row }]
    })
  })
}
export function changedRestoreFields(row: RestoreRow) {
  if (!row.current) return []
  const before = content(row.current), after = content(row.incoming)
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => fingerprint(before[key]) !== fingerprint(after[key])).map(key => ({ key, before: before[key], after: after[key] }))
}
const kindFor = Object.fromEntries(Object.entries(syncTables).map(([kind, table]) => [table, kind])) as Record<BackupCollection, SyncEntityKind>
async function checkSyncState(local: SyncingLocalRepositoryContext | undefined, current: DeviceBackup, rows: RestoreRow[]) {
  if (!local) return
  if ((await local.outbox.getAll()).length || (await local.conflicts.getAll()).length) throw new Error('有待同步修改或同步衝突，請先完成同步與核對，再重新選擇備份')
  const maps = new Map(backupCollections.map(key => [key, new Map(current.data[key].map(entity => [entity.id, entity]))]))
  for (const row of rows) {
    const baseline = await local.database.syncCache.get(`${kindFor[row.collection]}:${row.id}`)
    const existing = maps.get(row.collection)!.get(row.id)
    if (!existing && baseline) throw new Error('所選資料有已刪除或尚未完整載入的紀錄，請先到同步核對處理；本次不會復活已刪資料')
    if (existing && (!baseline || baseline.fingerprint !== fingerprint(existing) || baseline.revision !== existing.revision)) throw new Error('所選資料尚未與雲端完成核對，請先同步，再重新選擇備份')
  }
}
export async function restoreBackup(options: {
  repositories: ReadingCenterRepositories; verified: VerifiedBackup; expected: DeviceBackup; selected: ReadonlySet<string>
  local?: SyncingLocalRepositoryContext; now?: string; fetch?: typeof fetch; signal?: AbortSignal
}): Promise<number> {
  const { repositories, expected, selected, local } = options
  if (!repositories.transaction) throw new Error('此儲存環境不支援完整交易，無法安全還原')
  if (local && local.repositories !== repositories) throw new Error('還原儲存環境不一致，請重新開啟管理頁')
  const incoming = structuredClone(validateBackup(options.verified.backup))
  const rows = restoreRows(incoming, expected).filter(row => selected.has(row.key))
  if (!rows.length || rows.length !== selected.size) throw new Error('請重新核對並選擇要還原的資料')
  const now = options.now ?? new Date().toISOString(), merged = structuredClone(expected)
  const chosen = new Map<string, SyncableEntity>()
  const indices = new Map(backupCollections.map(key => [key, new Map(merged.data[key].map((entity, index) => [entity.id, index]))]))
  for (const row of rows) {
    const candidate = structuredClone(row.incoming)
    candidate.createdAt = row.current?.createdAt ?? candidate.createdAt; candidate.updatedAt = now; candidate.revision = (row.current?.revision ?? 0) + 1
    if (row.current?.provenance.kind === 'manual') candidate.provenance = structuredClone(row.current.provenance)
    chosen.set(row.key, candidate)
    const list = merged.data[row.collection] as SyncableEntity[], index = indices.get(row.collection)!.get(row.id)
    if (index === undefined) list.push(candidate); else list[index] = candidate
  }
  for (const key of backupCollections) merged.counts[key] = merged.data[key].length
  validateBackup(merged)
  if (relationWarnings(merged).length) throw new Error('還原後會有缺少或不一致的書籍／紀錄關聯，請一併選取需要的資料，或先核對目前書庫')
  validateRestoreReferences(merged)
  return withCloudSyncLock(async () => {
    const assertFresh = async () => {
      options.signal?.throwIfAborted()
      const latest = await captureDeviceBackup(repositories)
      if (fingerprint(latest.data) !== fingerprint(expected.data)) throw new Error('目前資料在預覽後已有更新，請重新選檔核對並保存新的還原前備份')
      await checkSyncState(local, latest, rows)
    }
    const checkRemote = async () => {
      if (!local) return
      const client = new CloudflareEntityClient('', options.fetch ?? fetch, options.signal)
      for (const collection of new Set(rows.map(row => row.collection))) {
        let remote
        try { remote = await client.list(kindFor[collection], true) } catch { throw new Error('需要連線確認雲端資料後才能還原；請確認登入與同步，再重試') }
        const byId = new Map<string, typeof remote[number]>()
        for (const entity of remote) { validateRemote(kindFor[collection], entity); if (byId.has(entity.id)) throw new Error('雲端資料不完整，請先核對同步'); byId.set(entity.id, entity) }
        for (const row of rows.filter(row => row.collection === collection)) {
          const entity = byId.get(row.id)
          if (entity?.deletedAt) throw new Error('所選資料在雲端已刪除，請先到同步核對處理；本次不會復活已刪資料')
          if ((entity?.payload ? fingerprint(entity.payload) : null) !== (row.current ? fingerprint(row.current) : null)) throw new Error('雲端資料與預覽不同，請先同步並重新核對備份')
        }
      }
    }
    await repositories.transaction!(assertFresh); await checkRemote()
    const uploaded = new Map<string, string>()
    // Finish network operations before the database transaction.
    for (const row of rows) {
      const entity = chosen.get(row.key)!
      if (!('cover' in entity) || !entity.cover) continue
      const bytes = options.verified.coverFiles.get(entity.cover.path)
      if (!bytes) continue
      const sourcePath = entity.cover.path
      let path = uploaded.get(sourcePath)
      if (!path) {
        const match = /^\/api\/v1\/covers\/covers\/(notion%3Abook%3A[0-9a-f]{64}%3A\d+|[0-9a-f-]{36})\/([0-9a-f]{64})-([^/?#]+)\.(jpg|png|webp|avif)$/.exec(sourcePath)
        if (!match || entity.cover.mimeType !== (match[4] === 'jpg' ? 'image/jpeg' : `image/${match[4]}`)) throw new Error('封面來源與圖片格式不符，尚未還原資料')
        const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
        if (hash !== match[2]) throw new Error('封面校驗失敗，尚未還原資料')
        options.signal?.throwIfAborted()
        const response = await (options.fetch ?? fetch)('/api/v1/covers/moon', { method: 'POST', credentials: 'include', redirect: 'error', signal: options.signal,
          headers: { 'Content-Type': entity.cover.mimeType, 'X-Book-Id': decodeURIComponent(match[1]), 'X-Book-Title': match[3] }, body: new Blob([bytes], { type: entity.cover.mimeType }) })
        if (!response.ok) throw new Error(`封面還原失敗（${response.status}）；資料尚未還原，請重試`)
        const body = await response.json() as { data?: { cover?: { path?: string; mimeType?: string }; sha256?: string; bytes?: number } }
        path = body.data?.cover?.path
        if (!path || path !== sourcePath || body.data?.cover?.mimeType !== entity.cover.mimeType || body.data.sha256 !== hash || body.data.bytes !== bytes.length) throw new Error('封面還原回應不符，資料尚未還原')
        uploaded.set(sourcePath, path)
      }
      entity.cover.path = path
    }
    await checkRemote()
    await repositories.transaction!(async () => {
      await assertFresh()
      for (const row of rows) { options.signal?.throwIfAborted(); await (repositories[row.collection] as { save(entity: SyncableEntity): Promise<void> }).save(chosen.get(row.key)!) }
    })
    return rows.length
  }, options.signal)
}
function validateRestoreReferences(backup: DeviceBackup) {
  const data = backup.data, dictionaries = new Map(data.dictionaries.map(row => [row.id, row.kind])), collections = new Set(data.collections.map(row => row.id))
  const dictionary = (id: string | null, kind: string) => { if (id !== null && (dictionaries.has(id) || /^(notion:dictionary:|[0-9a-f]{8}-)/.test(id)) && dictionaries.get(id) !== kind) throw new Error('還原後有缺少或類型不符的作者、分類、來源或裝置資料，請一併選取相關資料') }
  for (const row of [...data.books, ...data.works]) {
    for (const id of ('authorIds' in row ? row.authorIds : row.creatorIds)) dictionary(id, 'author')
    for (const credit of row.creatorCredits ?? []) dictionary(credit.creatorId, 'author')
    for (const [ids, kind] of [[row.categoryIds, 'category'], [row.tagIds, 'tag'], [row.sourceIds, 'source']] as const) for (const id of ids) dictionary(id, kind)
    for (const ref of row.externalReferences) dictionary(ref.sourceId, 'source')
    if ('mediaTypeId' in row) {
      dictionary(row.mediaTypeId, 'mediaType'); dictionary(row.publisherId, 'publisher')
      if (row.collectionId !== null && !collections.has(row.collectionId)) throw new Error('還原後缺少系列或期刊資料')
    } else if (row.typeMetadata.kind === 'publication') {
      dictionary(row.typeMetadata.publisherId, 'publisher')
      if (row.typeMetadata.collectionId !== null && !collections.has(row.typeMetadata.collectionId)) throw new Error('還原後缺少系列或期刊資料')
    }
  }
  for (const row of [...data.readingRecords, ...data.activityLogs]) { dictionary(row.deviceId, 'device'); dictionary(row.sourceId, 'source') }
}
