import { isBookSourceUrl, assertValidBook, assertValidDictionaryEntry, assertValidReadingContent, assertValidReadingCycle, createMetadata, type Book, type DictionaryEntry, type ReadingContent, type ReadingCycle } from '../domain'
import type { buildNotionImportPlan } from './notion-import-plan'
import type { buildNotionCoverManifest } from './notion-cover-manifest'
import { NOTION_CSV_SNAPSHOT_SOURCE_ID } from './notion-reimport-check'
import type { stageNotionImport } from './notion-staging'

type Plan = ReturnType<typeof buildNotionImportPlan>
type Staging = ReturnType<typeof stageNotionImport>
type CoverManifest = ReturnType<typeof buildNotionCoverManifest>
const splitSelection = (value: string): string[] => value.split(',').map((part) => part.trim()).filter(Boolean)
const plainSingleAuthor = (value: string): string | null => value && !/https?:\/\/|[,|：:]|\r|\n/.test(value) ? value : null

/** Small, read-only mapping prototype. Preview IDs must never be persisted. */
export function buildNotionEntityPrototype(plan: Plan, staging: Staging, selectedRowNumbers: readonly number[], now: string, coverManifest?: CoverManifest) {
  if (plan.csvSha256 !== staging.csvSha256 || !/^\d{4}-\d{2}-\d{2}T/.test(now)) throw new Error('Notion staging or prototype time is invalid')
  if (coverManifest && (coverManifest.kind !== 'notion-cover-manifest-preview' || coverManifest.csvSha256 !== plan.csvSha256)) throw new Error('Cover manifest belongs to a different import')
  const selected = new Set(selectedRowNumbers)
  const byRow = new Map(plan.items.map((item) => [item.rowNumber, item]))
  if (selected.size !== selectedRowNumbers.length || selected.size === 0 || selected.size > 50 || [...selected].some((number) => !byRow.has(number))) {
    throw new Error('Prototype selection must contain 1 to 50 distinct source rows')
  }
  const partialGroup = staging.workGroups.find((group) => group.sourceRowNumbers.some((number) => selected.has(number)) && !group.sourceRowNumbers.every((number) => selected.has(number)))
  if (partialGroup) throw new Error('Prototype selection must include every source row in a work group')
  const selectedGroups = staging.workGroups.filter((group) => group.sourceRowNumbers.every((number) => selected.has(number)))
  const books: Book[] = []
  const readingCycles: ReadingCycle[] = []
  const readingContents: ReadingContent[] = []
  const dictionaryEntries: DictionaryEntry[] = []
  const dictionaryByKey = new Map<string, DictionaryEntry>()
  const dictionaryId = (kind: 'author' | 'publisher' | 'category' | 'tag' | 'source', name: string): string => {
    const key = `${kind}:${name}`
    const existing = dictionaryByKey.get(key)
    if (existing) return existing.id
    const id = `preview:dictionary:${kind}:${encodeURIComponent(name)}`
    const metadata = createMetadata({ id, now, provenance: { kind: 'import', sourceId: NOTION_CSV_SNAPSHOT_SOURCE_ID, externalId: `${plan.csvSha256}:${key}`, importedAt: now } })
    const entry: DictionaryEntry = kind === 'author' ? { ...metadata, kind, name, color: null, aliases: [] } : { ...metadata, kind, name, color: null }
    assertValidDictionaryEntry(entry)
    dictionaryByKey.set(key, entry)
    dictionaryEntries.push(entry)
    return id
  }
  const unmappedBookMetadata: { bookId: string; sourceMetadata: Staging['workGroups'][number]['sourceMetadata']; publisherProposal: string | null; publisherDisplayProposal: string | null; conflictingPublishers: boolean }[] = []
  const externalLinkCandidates: { bookId: string; sourceRowNumber: number; url: string }[] = []
  const coverImportCandidates: { bookId: string; sourceRowNumbers: number[]; archiveFile: string; status: 'awaiting-file-copy' }[] = []
  const coverSelectionNeeded: { bookId: string; sourceRowNumbers: number[]; archiveFiles: string[] }[] = []
  const externalCoverCandidates: { bookId: string; sourceRowNumber: number; url: string; status: 'awaiting-download' }[] = []
  const coverByGroup = new Map(coverManifest?.workGroups.map((group) => [group.workStagingKey, group]) ?? [])
  const blocked: { sourceRowNumbers: number[]; reason: string }[] = []
  for (const group of selectedGroups) {
    if (group.blockedByMissingTitle || group.conflictingRatings) {
      blocked.push({ sourceRowNumbers: group.sourceRowNumbers, reason: group.blockedByMissingTitle ? 'missing_title' : 'conflicting_rating' })
      continue
    }
    const bookId = `preview:book:${group.stagingKey}`
    const categoryNames = [...new Set(group.sourceMetadata.flatMap((source) => splitSelection(source.categoryText)))]
    const tagNames = [...new Set(group.sourceMetadata.flatMap((source) => splitSelection(source.tagText)))]
    const authorNames = [...new Set(group.sourceMetadata.map((source) => plainSingleAuthor(source.authorText)).filter((name): name is string => name !== null))]
    const sourceNames = [...new Set(group.sourceMetadata.map((source) => source.sourcePlatform).filter(Boolean))]
    const publisherName = group.publisherDisplayProposal ?? (!group.conflictingPublishers ? group.publisherProposal : null)
    const book: Book = {
      ...createMetadata({ id: bookId, now, provenance: { kind: 'import', sourceId: NOTION_CSV_SNAPSHOT_SOURCE_ID, externalId: group.stagingKey, importedAt: now } }),
      title: group.title, preferredTitle: null, subtitle: null, originalTitle: null, languageTag: 'und', titleAliases: [],
      externalReferences: group.sourceRowNumbers.map((number) => {
        const item = byRow.get(number)!
        return { sourceId: NOTION_CSV_SNAPSHOT_SOURCE_ID, externalId: item.sourceRowKey, sourceTitle: item.suggested.title, sourceAuthorNames: item.suggested.creator ? [item.suggested.creator] : [] }
      }),
      publicationKind: 'other', collectionId: null, sequence: null, serialization: null, isbn: null, publishedOn: null,
      authorIds: authorNames.map((name) => dictionaryId('author', name)), publisherId: publisherName ? dictionaryId('publisher', publisherName) : null, mediaTypeId: 'unmapped', categoryIds: categoryNames.map((name) => dictionaryId('category', name)), tagIds: tagNames.map((name) => dictionaryId('tag', name)), sourceIds: sourceNames.map((name) => dictionaryId('source', name)), cover: null,
      rating: group.ratingProposal, sourceUrls: [...new Set(group.sourceMetadata.map((source) => source.sourceUrl).filter(isBookSourceUrl))], bookNote: '',
    }
    assertValidBook(book)
    books.push(book)
    unmappedBookMetadata.push({ bookId, sourceMetadata: group.sourceMetadata, publisherProposal: group.publisherProposal, publisherDisplayProposal: group.publisherDisplayProposal, conflictingPublishers: group.conflictingPublishers })
    const cover = coverByGroup.get(group.stagingKey)
    if (cover?.suggestedArchiveFile) coverImportCandidates.push({ bookId, sourceRowNumbers: group.sourceRowNumbers, archiveFile: cover.suggestedArchiveFile, status: 'awaiting-file-copy' })
    else if (cover?.needsCoverSelection) coverSelectionNeeded.push({ bookId, sourceRowNumbers: group.sourceRowNumbers, archiveFiles: [...new Set(cover.references.flatMap((reference) => reference.archiveFile ? [reference.archiveFile] : []))] })
    for (const reference of cover?.references ?? []) if (reference.availability === 'external-url') externalCoverCandidates.push({ bookId, sourceRowNumber: reference.sourceRowNumber, url: reference.value, status: 'awaiting-download' })
    for (const source of group.sourceMetadata) {
      if (!source.sourceUrl) continue
      try {
        const url = new URL(source.sourceUrl)
        if (url.protocol === 'https:' && url.hostname) externalLinkCandidates.push({ bookId, sourceRowNumber: source.sourceRowNumber, url: source.sourceUrl })
      } catch { /* Unparseable text remains in sourceMetadata for review. */ }
    }
    const candidates = staging.readingCandidates.filter((candidate) => candidate.workStagingKey === group.stagingKey)
    for (const candidate of candidates) {
      if (candidate.conflictingReportedReadingDays || candidate.readingStage === 'undetermined' || candidate.readingStage === 'abandoned') {
        blocked.push({ sourceRowNumbers: candidate.sourceRowNumbers, reason: candidate.conflictingReportedReadingDays ? 'conflicting_reported_days' : candidate.readingStage === 'undetermined' ? 'unknown_reading_status' : 'abandoned_reason_missing' })
        continue
      }
      const cycle: ReadingCycle = {
        ...createMetadata({ id: `preview:cycle:${plan.csvSha256}:${candidate.sourceRowNumbers[0]}`, now, provenance: { kind: 'import', sourceId: NOTION_CSV_SNAPSHOT_SOURCE_ID, externalId: `${plan.csvSha256}:${candidate.sourceRowNumbers[0]}`, importedAt: now } }),
        bookId, sequence: readingCycles.filter((item) => item.bookId === bookId).length + 1,
        status: candidate.readingStage, startedAt: null, finishedAt: null, completionDate: candidate.completionDate,
        reportedReadingDays: candidate.reportedReadingDays,
        abandonedReason: null
      }
      assertValidReadingCycle(cycle)
      readingCycles.push(cycle)
    }
    for (const review of staging.shortReviewCandidates.filter((candidate) => candidate.workStagingKey === group.stagingKey)) {
      const content: ReadingContent = {
        ...createMetadata({ id: `preview:short-review:${plan.csvSha256}:${review.sourceRowNumber}`, now, provenance: { kind: 'import', sourceId: NOTION_CSV_SNAPSHOT_SOURCE_ID, externalId: `${plan.csvSha256}:${review.sourceRowNumber}:short-review`, importedAt: now } }),
        type: 'shortReview', bookId, cycleId: null, readingRecordId: null, recordedForAt: null, text: review.text
      }
      assertValidReadingContent(content)
      readingContents.push(content)
    }
    // Ambiguous author text, publication metadata and cover references remain available for later mapping.
  }
  return {
    kind: 'notion-entity-prototype' as const, csvSha256: plan.csvSha256, formalWriteReady: false as const,
    summary: { selectedSourceRows: selected.size, bookPrototypes: books.length, authorPrototypes: dictionaryEntries.filter((entry) => entry.kind === 'author').length, publisherPrototypes: dictionaryEntries.filter((entry) => entry.kind === 'publisher').length, publisherNamesFromStorefront: selectedGroups.filter((group) => !group.blockedByMissingTitle && !group.conflictingRatings && group.publisherDisplayProposal).length, categoryPrototypes: dictionaryEntries.filter((entry) => entry.kind === 'category').length, tagPrototypes: dictionaryEntries.filter((entry) => entry.kind === 'tag').length, sourcePrototypes: dictionaryEntries.filter((entry) => entry.kind === 'source').length, externalLinkCandidates: externalLinkCandidates.length, coverImportCandidates: coverImportCandidates.length, coverSelectionNeeded: coverSelectionNeeded.length, externalCoverCandidates: externalCoverCandidates.length, cyclePrototypes: readingCycles.length, shortReviewPrototypes: readingContents.length, blockedItems: blocked.length, fabricatedReadingRecords: 0 },
    books, dictionaryEntries, externalLinkCandidates, coverImportCandidates, coverSelectionNeeded, externalCoverCandidates, readingCycles, readingContents, unmappedBookMetadata, blocked
  }
}
