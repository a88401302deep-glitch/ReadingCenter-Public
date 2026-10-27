import type { NotionNormalizationRow } from './reading-center-notion-normalization'
import type { ReadingCycleStatus } from '../domain/reading-cycle'

export type NotionReviewDecision = {
  date?: 'keep-source' | 'use-completion-date'
  duplicate?: 'separate' | 'same-work'
}

export type NotionReviewDecisions = Record<number, NotionReviewDecision>

export type ResolvedNotionReviewRow = {
  rowNumber: number
  status: ReadingCycleStatus | null
  completionDate: NotionNormalizationRow['proposed']['completionDate']
  duplicate: NotionReviewDecision['duplicate'] | null
  pendingReviewCodes: NotionNormalizationRow['reviewCodes']
}

/** Apply reviewed choices to a read-only proposal. The source rows are never changed. */
export function resolveNotionReviewRows(rows: NotionNormalizationRow[], decisions: NotionReviewDecisions): ResolvedNotionReviewRow[] {
  const originalStatuses: Record<string, ReadingCycleStatus> = {
    '尚未開始': 'planned', '閱讀中': 'reading', '已讀完': 'completed', '暫停': 'paused', '棄坑': 'abandoned', '閱讀(連載)': 'reading'
  }
  return rows.map((row) => {
    const choice = decisions[row.rowNumber]
    const keepSource = row.reviewCodes.includes('completion_date_status_conflict') && choice?.date === 'keep-source'
    const sourceStatus = String(row.source.values.status ?? '').trim()
    return {
      rowNumber: row.rowNumber,
      status: keepSource ? originalStatuses[sourceStatus] ?? null : row.proposed.status,
      completionDate: keepSource ? null : row.proposed.completionDate,
      duplicate: row.reviewCodes.includes('duplicate_candidate') ? choice?.duplicate ?? null : null,
      pendingReviewCodes: row.reviewCodes.filter((code) =>
        !((code === 'completion_date_status_conflict' && choice?.date) || (code === 'duplicate_candidate' && choice?.duplicate))
      )
    }
  })
}

export function serializeNotionReviewFile(csvSha256: string, rows: NotionNormalizationRow[], decisions: NotionReviewDecisions): string {
  const selected = rows.flatMap((row) => {
    const decision = decisions[row.rowNumber]
    if (!decision?.date && !decision?.duplicate) return []
    return [{ rowNumber: row.rowNumber, ...(decision.date ? { date: decision.date } : {}), ...(decision.duplicate ? { duplicate: decision.duplicate } : {}) }]
  })
  return JSON.stringify({ version: 1, csvSha256, rowCount: rows.length, decisions: selected }, null, 2)
}

export function parseNotionReviewFile(content: string, csvSha256: string, rows: NotionNormalizationRow[]): NotionReviewDecisions {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { throw new Error('核對檔不是有效的 JSON') }
  if (!isRecord(parsed) || parsed.version !== 1 || parsed.csvSha256 !== csvSha256 || parsed.rowCount !== rows.length || !Array.isArray(parsed.decisions)) {
    throw new Error('核對檔與目前的 CSV 不相符，請選擇原本核對時使用的 CSV')
  }
  if (parsed.decisions.length > rows.length) throw new Error('核對檔的資料筆數不正確')
  const reviewRows = new Map(rows.map((row) => [row.rowNumber, row]))
  const decisions: NotionReviewDecisions = {}
  for (const item of parsed.decisions) {
    if (!isRecord(item) || !Number.isSafeInteger(item.rowNumber) || Object.hasOwn(decisions, item.rowNumber as number)) {
      throw new Error('核對檔包含重複或無效的列號')
    }
    const rowNumber = item.rowNumber as number
    const row = reviewRows.get(rowNumber)
    if (!row || (item.date === undefined && item.duplicate === undefined) ||
      (item.date !== undefined && (!row.reviewCodes.includes('completion_date_status_conflict') || !['keep-source', 'use-completion-date'].includes(item.date as string))) ||
      (item.duplicate !== undefined && (!row.reviewCodes.includes('duplicate_candidate') || !['separate', 'same-work'].includes(item.duplicate as string)))) {
      throw new Error(`核對檔第 ${rowNumber} 行的選擇不適用於此 CSV`)
    }
    decisions[rowNumber] = { ...(item.date ? { date: item.date as NotionReviewDecision['date'] } : {}), ...(item.duplicate ? { duplicate: item.duplicate as NotionReviewDecision['duplicate'] } : {}) }
  }
  return decisions
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
