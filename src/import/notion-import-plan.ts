import type { NotionNormalizationRow } from './reading-center-notion-normalization'
import { resolveNotionReviewRows, type NotionReviewDecisions } from './notion-review-file'

export type NotionPairingResolution =
  | { kind: 'same-reading'; rowNumbers: [number, number]; keepCompletionFrom: number }
  | { kind: 'defer'; rowNumbers: [number, number] }
export type NotionWorkGroupingProposal = { kind: 'same-work-proposal'; rowNumbers: [number, number] }

/** A source snapshot for review. This is not a list of entities to write. */
export function buildNotionImportPlan(csvSha256: string, rows: NotionNormalizationRow[], decisions: NotionReviewDecisions, pairings: NotionPairingResolution[] = [], workGroupingProposals: NotionWorkGroupingProposal[] = []) {
  if (!/^[0-9a-f]{64}$/.test(csvSha256)) throw new Error('CSV fingerprint is invalid')
  const resolved = resolveNotionReviewRows(rows, decisions)
  const byNumber = new Map(rows.map((row) => [row.rowNumber, row]))
  const paired = new Set<number>()
  for (const pairing of pairings) {
    const [first, second] = pairing.rowNumbers
    if (first === second || !byNumber.has(first) || !byNumber.has(second) || paired.has(first) || paired.has(second) ||
      !pairing.rowNumbers.every((number) => decisions[number]?.duplicate === 'same-work') ||
      (pairing.kind === 'same-reading' && (!pairing.rowNumbers.includes(pairing.keepCompletionFrom) ||
        !pairing.rowNumbers.every((number) => byNumber.get(number)?.readingEvidence.hasRead &&
          resolved.find((row) => row.rowNumber === number)?.completionDate)))) {
      throw new Error('Pairing resolution does not match reviewed source rows')
    }
    paired.add(first)
    paired.add(second)
  }
  for (const proposal of workGroupingProposals) {
    const [first, second] = proposal.rowNumbers
    const firstRow = byNumber.get(first)
    const secondRow = byNumber.get(second)
    if (proposal.kind !== 'same-work-proposal' || first === second || !firstRow || !secondRow || paired.has(first) || paired.has(second) ||
      !proposal.rowNumbers.every((number) => decisions[number]?.duplicate === 'same-work') ||
      firstRow.proposed.title !== secondRow.proposed.title || firstRow.proposed.creator !== secondRow.proposed.creator ||
      !firstRow.proposed.title) throw new Error('Work grouping proposal does not match reviewed source rows')
    paired.add(first)
    paired.add(second)
  }
  const items = rows.map((row, index) => {
    const choice = resolved[index]
    const cover = String(row.source.raw['封面'] ?? '').trim()
    const daysText = /^總共閱讀(\d+)天$/.exec(String(row.source.raw['閱讀時間'] ?? '').trim())
    const recordedReadingDays = daysText && Number.isSafeInteger(Number(daysText[1])) ? Number(daysText[1]) : null
    return {
      sourceRowKey: `${csvSha256}:${row.rowNumber}`,
      rowNumber: row.rowNumber,
      source: row.source.raw,
      coverReferences: cover ? (/^https?:\/\//i.test(cover) ? [{ kind: 'external-url' as const, value: cover }] : cover.split(/,\s*(?=[^,]+\.(?:jpe?g|png|webp)(?:\s*,|\s*$))/i).map((value) => ({ kind: 'local-export-file' as const, value: value.trim() }))) : [],
      suggested: {
        title: row.proposed.title,
        creator: row.proposed.creator,
        rating: row.proposed.rating,
        recordedReadingDays,
        status: choice.status,
        completionDate: choice.completionDate,
        hasReadingEvidence: row.readingEvidence.hasRead,
        evidence: { time: row.readingEvidence.fromTime, dailyRelation: row.readingEvidence.fromDailyRelation },
        duplicate: choice.duplicate
      },
      pendingReviewCodes: choice.pendingReviewCodes
    }
  })
  return {
    version: 1,
    kind: 'notion-import-plan-preview' as const,
    csvSha256,
    rowCount: rows.length,
    sourceIdentityScope: 'csv-snapshot-and-row-number' as const,
    formalWriteReady: false,
    pairingResolutions: pairings,
    workGroupingProposals,
    summary: {
      readingEvidenceRows: items.filter((item) => item.suggested.hasReadingEvidence).length,
      datedCompletionRows: items.filter((item) => item.suggested.status === 'completed' && item.suggested.completionDate).length,
      confirmedUniqueDatedCompletions: items.filter((item) => item.suggested.status === 'completed' && item.suggested.completionDate).length - pairings.filter((pairing) => pairing.kind === 'same-reading').length,
      confirmedUniqueReadingRecords: items.filter((item) => item.suggested.hasReadingEvidence).length - pairings.filter((pairing) => pairing.kind === 'same-reading').length,
      uncorroboratedCompletedRows: items.filter((item) => item.source['閱讀']?.trim() === '已讀完' && !item.suggested.hasReadingEvidence).length,
      rowsWithPendingReview: items.filter((item) => item.pendingReviewCodes.length > 0).length,
      sameWorkCandidates: items.filter((item) => item.suggested.duplicate === 'same-work').length
    },
    items
  }
}
