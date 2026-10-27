import type { stageNotionImport } from './notion-staging'

type Staging = ReturnType<typeof stageNotionImport>
export interface ReviewedCoverSelection {
  sourceRowNumbers: number[]
  archiveFile: string
  expectedSha256: string
  evidenceUrl: string
  reason: string
}

/** References only; the ZIP bytes still need to be copied into durable storage. */
export function buildNotionCoverManifest(staging: Staging, availableFiles: readonly string[], sha256ByFile: Readonly<Record<string, string>> = {}, reviewedSelections: readonly ReviewedCoverSelection[] = []) {
  const files = new Set(availableFiles)
  const reviews = new Map(reviewedSelections.map((selection) => [selection.sourceRowNumbers.join(','), selection]))
  if (reviews.size !== reviewedSelections.length) throw new Error('Duplicate cover review')
  const usedReviews = new Set<string>()
  const workGroups = staging.workGroups.map((group) => {
    const reviewKey = group.sourceRowNumbers.join(',')
    const review = reviews.get(reviewKey)
    if (review) usedReviews.add(reviewKey)
    const references = group.coverReferences.map((reference) => {
      if (reference.kind === 'external-url') return { ...reference, archiveFile: null, availability: 'external-url' as const }
      let decoded = reference.value
      try { decoded = decodeURIComponent(reference.value) } catch { /* Keep original on malformed escapes. */ }
      const archiveFile = files.has(reference.value) ? reference.value : files.has(decoded) ? decoded : null
      return { ...reference, archiveFile, availability: archiveFile ? 'in-archive' as const : 'missing' as const }
    })
    const localFiles = [...new Set(references.flatMap((reference) => reference.archiveFile ? [reference.archiveFile] : []))]
    const digests = localFiles.map((file) => sha256ByFile[file])
    const sameImage = localFiles.length > 1 && digests.every((digest) => typeof digest === 'string' && /^[0-9a-f]{64}$/.test(digest) && digest === digests[0])
    if (review && (localFiles.length < 2 || !localFiles.includes(review.archiveFile) || sha256ByFile[review.archiveFile] !== review.expectedSha256 ||
      !/^https:\/\/[^\s]+$/.test(review.evidenceUrl) || !review.reason.trim())) throw new Error(`Invalid cover review for rows ${reviewKey}`)
    const suggestedArchiveFile = review?.archiveFile ?? (references.every((reference) => reference.availability === 'in-archive') && (localFiles.length === 1 || sameImage) ? localFiles[0] : null)
    return {
      workStagingKey: group.stagingKey,
      sourceRowNumbers: group.sourceRowNumbers,
      references,
      suggestedArchiveFile,
      reviewedSelection: review ?? null,
      identicalImageFiles: sameImage,
      needsCoverSelection: localFiles.length > 1 && suggestedArchiveFile === null && references.every((reference) => reference.availability === 'in-archive'),
      needsExternalCoverDownload: references.some((reference) => reference.availability === 'external-url'),
      needsMissingCoverRecovery: references.some((reference) => reference.availability === 'missing')
    }
  })
  if (usedReviews.size !== reviews.size) throw new Error('Cover review rows do not match the staged work groups')
  const refs = workGroups.flatMap((group) => group.references)
  return {
    kind: 'notion-cover-manifest-preview' as const,
    csvSha256: staging.csvSha256,
    formalWriteReady: false as const,
    summary: {
      referencedSourceRows: new Set(refs.map((reference) => reference.sourceRowNumber)).size,
      localReferencesMatched: refs.filter((reference) => reference.availability === 'in-archive').length,
      externalReferences: refs.filter((reference) => reference.availability === 'external-url').length,
      missingReferences: refs.filter((reference) => reference.availability === 'missing').length,
      workGroupsWithSuggestedLocalCover: workGroups.filter((group) => group.suggestedArchiveFile !== null).length,
      workGroupsWithIdenticalImageFiles: workGroups.filter((group) => group.identicalImageFiles).length,
      workGroupsWithReviewedSelection: workGroups.filter((group) => group.reviewedSelection !== null).length,
      workGroupsNeedingSelection: workGroups.filter((group) => group.needsCoverSelection).length,
      workGroupsNeedingExternalDownload: workGroups.filter((group) => group.needsExternalCoverDownload).length,
      workGroupsNeedingMissingCoverRecovery: workGroups.filter((group) => group.needsMissingCoverRecovery).length
    },
    workGroups
  }
}
