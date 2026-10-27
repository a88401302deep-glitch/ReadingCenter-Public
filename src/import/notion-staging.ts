import type { buildNotionImportPlan } from './notion-import-plan'
import { getNotionPublisherDisplayProposal } from './notion-publisher-normalization'

type Plan = ReturnType<typeof buildNotionImportPlan>
type Item = Plan['items'][number]
export type PublisherBookEvidence = {
  sourceTitle: string
  sourcePublisher: string
  displayName: string
  evidenceUrl: string
}

/** A reviewable work/reading split. This function never creates database entities. */
export function stageNotionImport(plan: Plan, publisherBookEvidence: Record<number, PublisherBookEvidence> = {}) {
  if (plan.kind !== 'notion-import-plan-preview' || plan.items.length !== plan.rowCount) throw new Error('Invalid Notion import plan')
  const byRow = new Map(plan.items.map((item) => [item.rowNumber, item]))
  if (byRow.size !== plan.rowCount) throw new Error('Repeated source row')
  for (const [key, evidence] of Object.entries(publisherBookEvidence)) {
    const item = byRow.get(Number(key))
    if (!item || item.source['書名']?.trim() !== evidence.sourceTitle || item.source['出版社']?.trim() !== evidence.sourcePublisher ||
      !evidence.displayName.trim() || !/^https:\/\/[^\s]+$/.test(evidence.evidenceUrl)) {
      throw new Error(`Publisher evidence does not match source row ${key}`)
    }
  }
  const groups: { rows: number[]; decision: 'single-source' | 'confirmed-same-reading' | 'same-work-proposal' | 'deferred' }[] = []
  const claimed = new Set<number>()
  const addPair = (rows: [number, number], decision: (typeof groups)[number]['decision']) => {
    if (rows[0] === rows[1] || rows.some((row) => !byRow.has(row) || claimed.has(row))) throw new Error('Overlapping or missing source rows')
    rows.forEach((row) => claimed.add(row))
    if (decision === 'deferred') rows.forEach((row) => groups.push({ rows: [row], decision }))
    else groups.push({ rows: [...rows], decision })
  }
  for (const pairing of plan.pairingResolutions) addPair(pairing.rowNumbers, pairing.kind === 'same-reading' ? 'confirmed-same-reading' : 'deferred')
  for (const proposal of plan.workGroupingProposals ?? []) addPair(proposal.rowNumbers, 'same-work-proposal')
  for (const item of plan.items) if (!claimed.has(item.rowNumber)) groups.push({ rows: [item.rowNumber], decision: 'single-source' })
  groups.sort((left, right) => Math.min(...left.rows) - Math.min(...right.rows))
  const workGroups = groups.map(({ rows, decision }) => {
    const items = rows.map((number) => byRow.get(number) as Item)
    const ratings = [...new Set(items.map((item) => item.suggested.rating).filter((rating): rating is number => typeof rating === 'number'))]
    const sourceMetadata = items.map((item) => {
      const bookEvidence = publisherBookEvidence[item.rowNumber]
      const proposal = bookEvidence ?? getNotionPublisherDisplayProposal(item.source['出版社'] ?? '')
      return {
        sourceRowNumber: item.rowNumber,
        authorText: item.source['作者']?.trim() ?? '',
        publisher: item.source['出版社']?.trim() ?? '',
        publisherDisplayProposal: proposal?.displayName ?? null,
        publisherEvidenceUrl: proposal?.evidenceUrl ?? null,
        publisherResolutionScope: bookEvidence ? 'verified-book' as const : proposal ? 'publisher-name' as const : null,
        categoryText: item.source['主題']?.trim() ?? '',
        tagText: item.source['標籤']?.trim() ?? '',
        sourcePlatform: item.source['來源']?.trim() ?? '',
        sourceUrl: item.source['網址']?.trim() ?? ''
      }
    })
    const publishers = [...new Set(sourceMetadata.map((source) => source.publisher).filter(Boolean))]
    const displayNames = [...new Set(sourceMetadata.map((source) => source.publisherDisplayProposal).filter((value): value is string => value !== null))]
    return {
      stagingKey: `${plan.csvSha256}:${Math.min(...rows)}`,
      decision,
      sourceRowNumbers: rows,
      title: items.find((item) => item.suggested.title)?.suggested.title ?? '',
      creator: items.find((item) => item.suggested.creator)?.suggested.creator ?? null,
      sourceMetadata,
      publisherProposal: publishers.length === 1 ? publishers[0] : null,
      publisherDisplayProposal: publishers.length > 0 && sourceMetadata.every((source) => !source.publisher || source.publisherDisplayProposal) && displayNames.length === 1 ? displayNames[0] : null,
      conflictingPublishers: publishers.length > 1,
      coverReferences: items.flatMap((item) => item.coverReferences.map((cover) => ({ ...cover, sourceRowNumber: item.rowNumber }))),
      ratingProposal: ratings.length === 1 ? { value: ratings[0], scale: 5 as const } : null,
      conflictingRatings: ratings.length > 1,
      blockedByMissingTitle: items.every((item) => !item.suggested.title),
      reviewCodes: [...new Set(items.flatMap((item) => item.pendingReviewCodes))]
    }
  })
  const workKeyByRow = new Map(workGroups.flatMap((group) => group.sourceRowNumbers.map((number) => [number, group.stagingKey] as const)))
  const duplicateByKeptRow = new Map(plan.pairingResolutions.filter((pairing) => pairing.kind === 'same-reading').map((pairing) => [pairing.keepCompletionFrom, pairing.rowNumbers] as const))
  const suppressedRows = new Set(plan.pairingResolutions.filter((pairing) => pairing.kind === 'same-reading').flatMap((pairing) => pairing.rowNumbers.filter((number) => number !== pairing.keepCompletionFrom)))
  const readingCandidates = plan.items.filter((item) => item.suggested.hasReadingEvidence && !suppressedRows.has(item.rowNumber)).map((item) => {
    const sourceRowNumbers = duplicateByKeptRow.get(item.rowNumber) ?? [item.rowNumber]
    const days = [...new Set(sourceRowNumbers.map((number) => byRow.get(number)?.suggested.recordedReadingDays).filter((value): value is number => typeof value === 'number' && value > 0))]
    return {
      workStagingKey: workKeyByRow.get(item.rowNumber) as string,
      sourceRowNumbers,
      sourceStatus: item.suggested.status,
      readingStage: item.suggested.status === 'planned' || item.suggested.status === null ? 'undetermined' as const : item.suggested.status,
      completionDate: item.suggested.status === 'completed' ? item.suggested.completionDate : null,
      reportedReadingDays: days.length === 1 ? days[0] : null,
      conflictingReportedReadingDays: days.length > 1,
      evidence: item.suggested.evidence,
      blockedByMissingTitle: !workGroups.find((group) => group.stagingKey === workKeyByRow.get(item.rowNumber))?.title
    }
  })
  const ratingCandidates = plan.items.filter((item) => typeof item.suggested.rating === 'number').map((item) => ({
    workStagingKey: workKeyByRow.get(item.rowNumber) as string,
    sourceRowNumber: item.rowNumber,
    rating: item.suggested.rating as number
  }))
  const shortReviewCandidates = plan.items.filter((item) => item.source['一行心得']?.trim()).map((item) => ({
    workStagingKey: workKeyByRow.get(item.rowNumber) as string,
    sourceRowNumber: item.rowNumber,
    text: item.source['一行心得'].trim(),
    recordedForAt: null as null
  }))
  const longReviewFlags = plan.items.filter((item) => item.source['心得']?.trim() === 'Yes').map((item) => ({
    workStagingKey: workKeyByRow.get(item.rowNumber) as string,
    sourceRowNumber: item.rowNumber,
    contentAvailable: false as const
  }))
  const prototypeBlockers = [
    ...workGroups.filter((group) => group.blockedByMissingTitle || group.conflictingRatings).map((group) => ({
      sourceRowNumbers: group.sourceRowNumbers,
      reason: group.blockedByMissingTitle ? 'missing_title' as const : 'conflicting_rating' as const
    })),
    ...readingCandidates.filter((candidate) => {
      const group = workGroups.find((item) => item.stagingKey === candidate.workStagingKey)
      return !group?.blockedByMissingTitle && !group?.conflictingRatings &&
        (candidate.conflictingReportedReadingDays || candidate.readingStage === 'undetermined' || candidate.readingStage === 'abandoned')
    }).map((candidate) => ({
      sourceRowNumbers: candidate.sourceRowNumbers,
      reason: candidate.conflictingReportedReadingDays ? 'conflicting_reported_days' as const :
        candidate.readingStage === 'undetermined' ? 'unknown_reading_status' as const : 'abandoned_reason_missing' as const
    }))
  ]
  return {
    kind: 'notion-staging-preview' as const,
    csvSha256: plan.csvSha256,
    formalWriteReady: false as const,
    summary: {
      sourceRows: plan.rowCount,
      workGroups: workGroups.length,
      titledWorkGroups: workGroups.filter((group) => !group.blockedByMissingTitle).length,
      proposedWorkGroups: workGroups.filter((group) => group.decision === 'same-work-proposal').length,
      workGroupsWithConflictingRatings: workGroups.filter((group) => group.conflictingRatings).length,
      workGroupsWithConflictingPublishers: workGroups.filter((group) => group.conflictingPublishers).length,
      sourceRowsWithPublisher: workGroups.reduce((total, group) => total + group.sourceMetadata.filter((source) => source.publisher).length, 0),
      sourceRowsWithPublisherDisplayProposal: workGroups.reduce((total, group) => total + group.sourceMetadata.filter((source) => source.publisherDisplayProposal).length, 0),
      sourceRowsWithBookVerifiedPublisher: workGroups.reduce((total, group) => total + group.sourceMetadata.filter((source) => source.publisherResolutionScope === 'verified-book').length, 0),
      sourceRowsWithCategory: workGroups.reduce((total, group) => total + group.sourceMetadata.filter((source) => source.categoryText).length, 0),
      sourceRowsWithTag: workGroups.reduce((total, group) => total + group.sourceMetadata.filter((source) => source.tagText).length, 0),
      sourceRowsWithPlatform: workGroups.reduce((total, group) => total + group.sourceMetadata.filter((source) => source.sourcePlatform).length, 0),
      deferredSourceRows: workGroups.filter((group) => group.decision === 'deferred').length,
      readingCandidates: readingCandidates.length,
      datedCompletions: readingCandidates.filter((candidate) => candidate.completionDate !== null).length,
      withReportedReadingDays: readingCandidates.filter((candidate) => candidate.reportedReadingDays !== null).length,
      conflictingReportedReadingDays: readingCandidates.filter((candidate) => candidate.conflictingReportedReadingDays).length,
      ratedSourceRows: ratingCandidates.length,
      shortReviewSourceRows: shortReviewCandidates.length,
      longReviewFlagSourceRows: longReviewFlags.length,
      sourceRowsWithoutReadingEvidence: plan.items.filter((item) => !item.suggested.hasReadingEvidence).length,
      prototypeBlockedItems: prototypeBlockers.length
    },
    workGroups,
    readingCandidates,
    ratingCandidates,
    shortReviewCandidates,
    longReviewFlags,
    prototypeBlockers
  }
}
