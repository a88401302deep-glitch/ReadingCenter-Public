import type { NotionNormalizationRow } from './reading-center-notion-normalization'
import type { NotionReviewDecisions } from './notion-review-file'
import { buildNotionImportPlan, type NotionPairingResolution, type NotionWorkGroupingProposal } from './notion-import-plan'

type RecordValue = Record<string, unknown>
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value)
const pair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger)

/** Rebuild a reviewed plan from this CSV and these decisions; do not trust uploaded entity data. */
export function parseReviewedNotionPlan(content: string, csvSha256: string, rows: NotionNormalizationRow[], decisions: NotionReviewDecisions) {
  let value: unknown
  try { value = JSON.parse(content) } catch { throw new Error('配對計畫不是有效的 JSON') }
  if (!record(value) || value.version !== 1 || value.kind !== 'notion-import-plan-preview' ||
    value.csvSha256 !== csvSha256 || value.rowCount !== rows.length ||
    value.sourceIdentityScope !== 'csv-snapshot-and-row-number' || !Array.isArray(value.items) ||
    !Array.isArray(value.pairingResolutions) || !Array.isArray(value.workGroupingProposals)) {
    throw new Error('配對計畫與目前的 CSV 不相符')
  }
  if (value.pairingResolutions.length + value.workGroupingProposals.length > rows.length) throw new Error('配對計畫的筆數不正確')
  const pairings: NotionPairingResolution[] = value.pairingResolutions.map((item: unknown) => {
    if (!record(item) || !pair(item.rowNumbers) ||
      (item.kind !== 'same-reading' && item.kind !== 'defer') ||
      (item.kind === 'same-reading' && !Number.isSafeInteger(item.keepCompletionFrom))) throw new Error('配對計畫包含無效的閱讀配對')
    return item.kind === 'same-reading'
      ? { kind: 'same-reading', rowNumbers: item.rowNumbers, keepCompletionFrom: item.keepCompletionFrom as number }
      : { kind: 'defer', rowNumbers: item.rowNumbers }
  })
  const proposals: NotionWorkGroupingProposal[] = value.workGroupingProposals.map((item: unknown) => {
    if (!record(item) || item.kind !== 'same-work-proposal' || !pair(item.rowNumbers)) throw new Error('配對計畫包含無效的作品分組')
    return { kind: 'same-work-proposal', rowNumbers: item.rowNumbers }
  })
  let rebuilt: ReturnType<typeof buildNotionImportPlan>
  try { rebuilt = buildNotionImportPlan(csvSha256, rows, decisions, pairings, proposals) }
  catch { throw new Error('配對計畫與目前的核對選擇不相符') }
  if (JSON.stringify(value.items) !== JSON.stringify(rebuilt.items)) throw new Error('配對計畫的來源列或核對選擇與目前資料不相符')
  return rebuilt
}
