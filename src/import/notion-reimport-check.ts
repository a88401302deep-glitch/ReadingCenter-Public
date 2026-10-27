import type { Book } from '../domain/book'
import type { ReadingCenterRepositories } from '../data/repository'
import type { CloudflareEntityClient } from '../sync/cloudflare/entity-client'
import { RemoteProtocolError } from '../sync/cloudflare/entity-client'
import type { buildNotionImportPlan } from './notion-import-plan'
import type { stageNotionImport } from './notion-staging'

export const NOTION_CSV_SNAPSHOT_SOURCE_ID = 'notion-csv-snapshot'
type Plan = ReturnType<typeof buildNotionImportPlan>

/** Exact snapshot references only. A changed export needs its own explicit mapping. */
export function checkNotionReimport(plan: Plan, existingBooks: Pick<Book, 'id' | 'provenance' | 'externalReferences'>[]) {
  if (plan.kind !== 'notion-import-plan-preview' || plan.sourceIdentityScope !== 'csv-snapshot-and-row-number' ||
    plan.items.length !== plan.rowCount || !/^[0-9a-f]{64}$/.test(plan.csvSha256)) {
    throw new Error('Invalid Notion source snapshot')
  }
  const references = new Map<string, Set<string>>()
  for (const book of existingBooks) {
    const keys = book.externalReferences.filter((ref) => ref.sourceId === NOTION_CSV_SNAPSHOT_SOURCE_ID).map((ref) => ref.externalId)
    if (book.provenance.kind === 'import' && book.provenance.sourceId === NOTION_CSV_SNAPSHOT_SOURCE_ID) keys.push(book.provenance.externalId)
    for (const key of keys) {
      const ids = references.get(key) ?? new Set<string>()
      ids.add(book.id)
      references.set(key, ids)
    }
  }
  const seen = new Set<string>()
  const entries = plan.items.map((item) => {
    if (item.sourceRowKey !== `${plan.csvSha256}:${item.rowNumber}` || seen.has(item.sourceRowKey)) throw new Error('Invalid or repeated Notion row key')
    seen.add(item.sourceRowKey)
    const ids = [...(references.get(item.sourceRowKey) ?? [])]
    return { rowNumber: item.rowNumber, sourceRowKey: item.sourceRowKey, kind: ids.length > 1 ? 'conflict' as const : ids.length ? 'existing' as const : 'unmatched' as const, bookIds: ids }
  })
  const entryByRow = new Map(entries.map((entry) => [entry.rowNumber, entry]))
  const pairingConflicts = plan.pairingResolutions.filter((pairing) => {
    if (pairing.kind !== 'same-reading') return false
    const ids = new Set(pairing.rowNumbers.flatMap((rowNumber) => entryByRow.get(rowNumber)?.bookIds ?? []))
    return ids.size > 1
  }).map((pairing) => pairing.rowNumbers)
  return {
    sourceIdentityScope: plan.sourceIdentityScope,
    formalWriteReady: false as const,
    summary: {
      alreadyLinkedRows: entries.filter((entry) => entry.kind === 'existing').length,
      unmatchedRows: entries.filter((entry) => entry.kind === 'unmatched').length,
      conflictingRows: entries.filter((entry) => entry.kind === 'conflict').length,
      conflictingConfirmedPairs: pairingConflicts.length
    },
    entries,
    pairingConflicts
  }
}

type Staging = ReturnType<typeof stageNotionImport>
type ExistingBook = Pick<Book, 'id' | 'title' | 'preferredTitle' | 'titleAliases' | 'provenance' | 'externalReferences'>

/** One read-only decision per proposed work. Titles are review clues, never identity keys. */
export function checkNotionWorkCollisions(plan: Plan, staging: Staging, existingBooks: ExistingBook[]) {
  const reimport = checkNotionReimport(plan, existingBooks)
  if (staging.kind !== 'notion-staging-preview' || staging.csvSha256 !== plan.csvSha256 ||
    staging.summary.sourceRows !== plan.rowCount || staging.workGroups.length !== staging.summary.workGroups) {
    throw new Error('Staging does not match Notion source snapshot')
  }
  const rowEntries = new Map(reimport.entries.map((entry) => [entry.rowNumber, entry]))
  const pendingSameWorkRows = new Set(plan.items.filter((item) => item.suggested.duplicate === 'same-work').map((item) => item.rowNumber))
  const covered = new Set<number>()
  const groups = staging.workGroups.map((group) => {
    const linkedIds = new Set<string>()
    for (const row of group.sourceRowNumbers) {
      if (!rowEntries.has(row) || covered.has(row)) throw new Error('Invalid or repeated staged row')
      covered.add(row)
      rowEntries.get(row)?.bookIds.forEach((id) => linkedIds.add(id))
    }
    const possibleBookIds = !linkedIds.size && group.title.trim() ? [...new Set(existingBooks
      .filter((book) => [book.title, book.preferredTitle, ...book.titleAliases].some((title) => title?.trim() === group.title.trim()))
      .map((book) => book.id))] : []
    const kind = linkedIds.size > 1 ? 'conflict' as const :
      group.blockedByMissingTitle ? 'blocked' as const :
        group.decision === 'deferred' || group.decision === 'same-work-proposal' ||
          (group.decision === 'single-source' && group.sourceRowNumbers.some((row) => pendingSameWorkRows.has(row))) ? 'review' as const :
          linkedIds.size === 1 ? 'linked' as const : possibleBookIds.length ? 'review' as const : 'new' as const
    return {
      stagingKey: group.stagingKey,
      sourceRowNumbers: group.sourceRowNumbers,
      kind,
      linkedBookIds: [...linkedIds],
      possibleBookIds,
      reason: kind === 'conflict' ? 'multiple_source_links' as const :
        group.blockedByMissingTitle ? 'missing_title' as const :
          group.decision === 'deferred' ? 'deferred_grouping' as const :
            group.decision === 'same-work-proposal' ? 'unconfirmed_grouping' as const :
              group.decision === 'single-source' && group.sourceRowNumbers.some((row) => pendingSameWorkRows.has(row)) ? 'unpaired_same_work' as const :
              possibleBookIds.length ? 'title_match_requires_review' as const : null
    }
  })
  if (covered.size !== plan.rowCount) throw new Error('Staging omits source rows')
  return {
    sourceIdentityScope: reimport.sourceIdentityScope,
    comparisonScope: 'provided-book-repository' as const,
    formalWriteReady: false as const,
    summary: {
      existingBooksCompared: existingBooks.length,
      linkedGroups: groups.filter((group) => group.kind === 'linked').length,
      newGroups: groups.filter((group) => group.kind === 'new').length,
      reviewGroups: groups.filter((group) => group.kind === 'review').length,
      blockedGroups: groups.filter((group) => group.kind === 'blocked').length,
      conflictingGroups: groups.filter((group) => group.kind === 'conflict').length
    },
    groups
  }
}

/** Load the current book repository for a read-only preflight. */
export async function checkNotionWorkCollisionsInRepository(plan: Plan, staging: Staging, repositories: Pick<ReadingCenterRepositories, 'books'>) {
  return checkNotionWorkCollisions(plan, staging, await repositories.books.getAll())
}

/** The formal destination is D1. Never fall back to IndexedDB on a remote error. */
export async function checkNotionWorkCollisionsInRemote(plan: Plan, staging: Staging, client: Pick<CloudflareEntityClient, 'list'>) {
  const stored = await client.list('book')
  const books: ExistingBook[] = stored.map((item) => {
    const book = item.payload
    if (item.kind !== 'book' || item.deletedAt !== null || !book || book.id !== item.id ||
      typeof book.title !== 'string' ||
      !(book.preferredTitle === null || typeof book.preferredTitle === 'string') ||
      !Array.isArray(book.titleAliases) || !book.titleAliases.every((alias) => typeof alias === 'string') ||
      !Array.isArray(book.externalReferences) || !book.externalReferences.every((ref: unknown) =>
        typeof ref === 'object' && ref !== null && 'sourceId' in ref && typeof ref.sourceId === 'string' &&
        'externalId' in ref && typeof ref.externalId === 'string') ||
      !book.provenance || typeof book.provenance !== 'object' || !('kind' in book.provenance) ||
      (book.provenance.kind !== 'manual' && !(book.provenance.kind === 'import' && typeof book.provenance.sourceId === 'string' && typeof book.provenance.externalId === 'string'))) {
      throw new RemoteProtocolError('Remote book data is invalid')
    }
    return book as unknown as ExistingBook
  })
  return checkNotionWorkCollisions(plan, staging, books)
}
