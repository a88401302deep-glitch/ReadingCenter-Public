import type { Book, BookCover, DictionaryEntry, ReadingContent, ReadingCycle } from '../domain'
import { buildNotionEntityPrototype } from './notion-entity-prototype'
import type { buildNotionImportPlan } from './notion-import-plan'
import type { stageNotionImport } from './notion-staging'

export type NotionBatchItem =
  | { kind: 'dictionary'; entity: DictionaryEntry }
  | { kind: 'book'; entity: Book }
  | { kind: 'readingCycle'; entity: ReadingCycle }
  | { kind: 'readingContent'; entity: ReadingContent }

/** Converts one resolved work from review prototypes to durable IDs. */
export function buildNotionPilotBatch(plan: ReturnType<typeof buildNotionImportPlan>, staging: ReturnType<typeof stageNotionImport>, rows: readonly number[], mediaTypeId: string, now: string, uploadedCover?: BookCover): NotionBatchItem[] {
  const group = staging.workGroups.find((work) => work.sourceRowNumbers.length === rows.length && work.sourceRowNumbers.every((row) => rows.includes(row)))
  if (group?.sourceMetadata.some((source) => source.publisher && (!source.publisherDisplayProposal || !source.publisherEvidenceUrl))) {
    throw new Error('Pilot publisher review requires bookstore display evidence')
  }
  if (!group || (group.decision !== 'single-source' && group.decision !== 'confirmed-same-reading') ||
    group.coverReferences.length > 1 || group.coverReferences.some((cover) => cover.kind !== 'local-export-file') ||
    Boolean(group.coverReferences.length) !== Boolean(uploadedCover) ||
    group.blockedByMissingTitle || group.conflictingRatings || !mediaTypeId.trim() || mediaTypeId === 'unmapped' ||
    group.reviewCodes.length || staging.longReviewFlags.some((flag) => flag.workStagingKey === group.stagingKey)) {
    throw new Error('Pilot work still needs grouping, metadata or cover review')
  }
  const prototype = buildNotionEntityPrototype(plan, staging, rows, now)
  if (prototype.books.length !== 1 || prototype.blocked.length || prototype.externalLinkCandidates.length ||
    prototype.coverImportCandidates.length || prototype.coverSelectionNeeded.length || prototype.externalCoverCandidates.length) {
    throw new Error('Pilot work contains records not yet safe to persist')
  }
  const dictionaryIds = new Map(prototype.dictionaryEntries.map((entry) => [entry.id, `notion:dictionary:${plan.csvSha256}:${entry.kind}:${encodeURIComponent(entry.name)}`]))
  const bookId = `notion:book:${group.stagingKey}`
  if (uploadedCover && !uploadedCover.path.startsWith(`/api/v1/covers/covers/${encodeURIComponent(bookId)}/`)) {
    throw new Error('Uploaded cover does not belong to this work')
  }
  const dictionaries: NotionBatchItem[] = prototype.dictionaryEntries.map((entry) => ({ kind: 'dictionary', entity: { ...entry, id: dictionaryIds.get(entry.id)! } }))
  const book: Book = {
    ...prototype.books[0], id: bookId, mediaTypeId, cover: uploadedCover ?? null,
    authorIds: prototype.books[0].authorIds.map((id) => dictionaryIds.get(id)!),
    publisherId: prototype.books[0].publisherId ? dictionaryIds.get(prototype.books[0].publisherId)! : null,
    categoryIds: prototype.books[0].categoryIds.map((id) => dictionaryIds.get(id)!),
    tagIds: prototype.books[0].tagIds.map((id) => dictionaryIds.get(id)!),
    sourceIds: prototype.books[0].sourceIds.map((id) => dictionaryIds.get(id)!)
  }
  return [
    ...dictionaries, { kind: 'book', entity: book },
    ...prototype.readingCycles.map((cycle, index): NotionBatchItem => ({ kind: 'readingCycle', entity: { ...cycle, id: `notion:cycle:${plan.csvSha256}:${cycle.provenance.kind === 'import' ? cycle.provenance.externalId.split(':').at(-1) : index}`, bookId } })),
    ...prototype.readingContents.map((content, index): NotionBatchItem => ({ kind: 'readingContent', entity: { ...content, id: `notion:short-review:${plan.csvSha256}:${content.provenance.kind === 'import' ? content.provenance.externalId.split(':').at(-2) : index}`, bookId } }))
  ]
}
