import type { AtomicMoonD1Database, MoonBackupD1ImportResult, MoonBackupD1Snapshot } from './moon-backup-d1-import'
import { importMoonBackupD1Batch } from './moon-backup-d1-import'
import { parseMoonBackup, type ParsedMoonBackup } from './moon-backup-parser'
import { OneDriveMoonBackupDownloader } from './onedrive-moon-backup-download'
import type { GraphAccessTokenProvider, MoonBackupDriveFile } from './onedrive-moon-backup-source'
import { OneDriveMoonBackupSource } from './onedrive-moon-backup-source'

export interface OneDriveMoonBackupSyncOptions {
  database: AtomicMoonD1Database
  tokenProvider: GraphAccessTokenProvider
  fetch?: typeof globalThis.fetch
  graphBaseUrl?: string
  folderPath?: string
  parse?: (bytes: Uint8Array) => Promise<ParsedMoonBackup>
  now?: string
}

export interface OneDriveMoonBackupSyncResult extends MoonBackupD1ImportResult {
  scannedFiles: number
  selectedBackups: number
}

/** Select the newest complete database snapshot from each device folder. */
export function selectLatestMoonBackups(files: MoonBackupDriveFile[]): MoonBackupDriveFile[] {
  const byDevice = new Map<string, MoonBackupDriveFile[]>()
  for (const file of files) {
    const group = byDevice.get(file.deviceFolder) ?? []
    group.push(file)
    byDevice.set(file.deviceFolder, group)
  }

  const selected: MoonBackupDriveFile[] = []
  for (const [device, candidates] of byDevice) {
    if (candidates.length === 1) {
      selected.push(candidates[0])
      continue
    }
    if (candidates.some(file => !file.lastModifiedDateTime || !Number.isFinite(Date.parse(file.lastModifiedDateTime)))) {
      throw new Error(`Cannot safely choose the latest Moon+ backup for ${device}`)
    }
    const latestTime = Math.max(...candidates.map(file => Date.parse(file.lastModifiedDateTime!)))
    const latest = candidates.filter(file => Date.parse(file.lastModifiedDateTime!) === latestTime)
    if (latest.length !== 1) throw new Error(`More than one latest Moon+ backup exists for ${device}`)
    selected.push(latest[0])
  }
  return selected.sort((a, b) => a.deviceFolder.localeCompare(b.deviceFolder))
}

/** Lists, downloads, parses, and imports one latest backup per device in a single D1 batch. */
export async function syncOneDriveMoonBackups(
  options: OneDriveMoonBackupSyncOptions
): Promise<OneDriveMoonBackupSyncResult> {
  const source = new OneDriveMoonBackupSource({
    tokenProvider: options.tokenProvider,
    fetch: options.fetch,
    graphBaseUrl: options.graphBaseUrl,
    folderPath: options.folderPath
  })
  const files = await source.listBackups()
  const selected = selectLatestMoonBackups(files)
  if (!selected.length) {
    return {
      scannedFiles: 0,
      selectedBackups: 0,
      booksCreated: 0,
      booksMatched: 0,
      booksPending: 0,
      statistics: { imported: 0, updated: 0, skipped: 0, duplicateDays: 0 }
    }
  }

  const downloader = new OneDriveMoonBackupDownloader({
    tokenProvider: options.tokenProvider,
    fetch: options.fetch,
    graphBaseUrl: options.graphBaseUrl
  })
  const parse = options.parse ?? parseMoonBackup
  const snapshots: MoonBackupD1Snapshot[] = []
  for (const file of selected) {
    const bytes = await downloader.download(file)
    const backup = await parse(bytes)
    snapshots.push({ deviceId: file.deviceFolder, name: file.name, backup })
  }

  return {
    scannedFiles: files.length,
    selectedBackups: selected.length,
    ...await importMoonBackupD1Batch(options.database, snapshots, options.now)
  }
}
