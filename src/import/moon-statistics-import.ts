import { assertValidSourceReadingDay, createMetadata, updateEntity, sourceDayDate, type SourceReadingDay } from '../domain'
import type { ReadingCenterRepositories } from '../data'
import { combineMoonStatistics, type MoonStatistic } from './moon-statistics'
import { moonSourceTitle } from './moon-book-matching'

export interface MoonImportSnapshot { deviceId: string; name: string; statistics: MoonStatistic[] }
export interface MoonStatisticsPlan { rows: SourceReadingDay[]; duplicateDays: number }
const keyOf = (deviceId: string, path: string, dayCode: number) => JSON.stringify([deviceId, path, dayCode])
const sourceKeyOf = (deviceId: string, path: string) => JSON.stringify([deviceId, path])
const sameValues = (a: SourceReadingDay, b: SourceReadingDay) => a.durationMs === b.durationMs && a.readWords === b.readWords && a.progressPercent === b.progressPercent
async function sourceId(key: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))
  return `moon-day-${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`
}

/** Parse and validate all source rows before opening the repository transaction. */
export async function planMoonStatistics(
  snapshots: MoonImportSnapshot[],
  disputedPaths: ReadonlySet<string> = new Set(),
  now = new Date().toISOString(),
  bookAssignments: ReadonlyMap<string, string> = new Map()
): Promise<MoonStatisticsPlan> {
  const combined = combineMoonStatistics(snapshots)
  if (combined.conflictCount) throw new Error(`有 ${combined.conflictCount} 組來源每日數值不同，尚未匯入；請核對備份`)
  const rows = await Promise.all(combined.records.map(async row => {
    const key = keyOf(row.deviceId, row.path, row.day.dayCode)
    const origin = snapshots.find(s => s.deviceId === row.deviceId && s.statistics.some(stat => stat.path === row.path))!
    const entity: SourceReadingDay = {
      ...createMetadata({ id: await sourceId(key), now, provenance: { kind: 'import', sourceId: 'moon-reader', externalId: key, importedAt: now } }),
      source: 'moon', deviceId: row.deviceId, sourcePath: row.path, sourceTitle: moonSourceTitle(row.path), backupName: origin.name,
      ...row.day, date: sourceDayDate(row.day.dayCode), bookId: bookAssignments.get(sourceKeyOf(row.deviceId, row.path)) ?? null,
      completionDisputed: disputedPaths.has(sourceKeyOf(row.deviceId, row.path))
    }
    assertValidSourceReadingDay(entity)
    return entity
  }))
  return { rows, duplicateDays: combined.duplicateDays }
}

/** Persist a pre-parsed plan inside a caller-owned transaction. */
export async function persistMoonStatisticsPlan(repositories: ReadingCenterRepositories, plan: MoonStatisticsPlan, now = new Date().toISOString()) {
  const existing = new Map((await repositories.sourceReadingDays.getAll()).map(row => [row.id, row]))
  const changes = plan.rows.flatMap(row => {
    const previous = existing.get(row.id)
    if (!previous) return [row]
    if (!sameValues(previous, row)) throw new Error(`來源數值與已存紀錄不同：${row.deviceId}／${row.sourceTitle}／${row.date}；未覆寫`)
    // A previously assigned book may reflect a manual review; never replace it.
    if (previous.bookId !== null || row.bookId === null) return []
    return [updateEntity(previous, { bookId: row.bookId }, now)]
  })
  // Preflight the complete batch before any writes. IndexedDB also wraps the
  // rows and sync outbox in one transaction, so failure cannot leave half a batch.
  for (const row of changes) await repositories.sourceReadingDays.save(row)
  const imported = changes.filter(row => !existing.has(row.id)).length
  return { imported, skipped: plan.rows.length - imported + plan.duplicateDays }
}

/** Persist source daily rows inside a transaction, planning them before opening it. */
export async function persistMoonStatistics(
  repositories: ReadingCenterRepositories,
  snapshots: MoonImportSnapshot[],
  disputedPaths: ReadonlySet<string> = new Set(),
  now = new Date().toISOString(),
  bookAssignments: ReadonlyMap<string, string> = new Map()
) {
  const plan = await planMoonStatistics(snapshots, disputedPaths, now, bookAssignments)
  const persist = () => persistMoonStatisticsPlan(repositories, plan, now)
  return repositories.transaction ? repositories.transaction(persist) : persist()
}
export async function importMoonStatistics(
  repositories: ReadingCenterRepositories,
  snapshots: MoonImportSnapshot[],
  disputedPaths: ReadonlySet<string> = new Set(),
  now = new Date().toISOString()
) {
  return persistMoonStatistics(repositories, snapshots, disputedPaths, now)
}
