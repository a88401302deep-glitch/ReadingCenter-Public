import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { checkNotionReimport, checkNotionWorkCollisions, checkNotionWorkCollisionsInRemote, checkNotionWorkCollisionsInRepository, NOTION_CSV_SNAPSHOT_SOURCE_ID } from '../../src/import/notion-reimport-check'
import { stageNotionImport } from '../../src/import/notion-staging'
import type { Book } from '../../src/domain/book'

const hash = 'a'.repeat(64)
const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得', '相同,甲,已讀完,0,,,2022/12/12,', '相同,甲,已讀完,0,,,2022/12/31,'].join('\n')
const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
const decisions = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
const plan = buildNotionImportPlan(hash, rows, decisions, [{ kind: 'same-reading', rowNumbers: [2, 3], keepCompletionFrom: 2 }])
const existing = (id: string, rowNumber: number): Pick<Book, 'id' | 'provenance' | 'externalReferences'> => ({
  id,
  provenance: { kind: 'import', sourceId: NOTION_CSV_SNAPSHOT_SOURCE_ID, externalId: `${hash}:${rowNumber}`, importedAt: '2026-09-23T00:00:00.000Z' },
  externalReferences: []
})
const libraryBook = (id: string, title: string, rowNumber?: number): Pick<Book, 'id' | 'title' | 'preferredTitle' | 'titleAliases' | 'provenance' | 'externalReferences'> => ({
  id, title, preferredTitle: null, titleAliases: [],
  provenance: rowNumber ? existing(id, rowNumber).provenance : { kind: 'manual' },
  externalReferences: []
})

describe('Notion snapshot reimport check', () => {
  it('matches only exact source keys, never titles or neighboring exports', () => {
    const result = checkNotionReimport(plan, [existing('one', 2), { ...existing('other', 3), provenance: { kind: 'import', sourceId: NOTION_CSV_SNAPSHOT_SOURCE_ID, externalId: `${'b'.repeat(64)}:3`, importedAt: '2026-09-23T00:00:00.000Z' } }])
    expect(result.summary).toMatchObject({ alreadyLinkedRows: 1, unmatchedRows: 1, conflictingConfirmedPairs: 0 })
    expect(result.formalWriteReady).toBe(false)
  })

  it('blocks a confirmed pair linked to different books', () => {
    const result = checkNotionReimport(plan, [existing('one', 2), existing('two', 3)])
    expect(result.summary.conflictingConfirmedPairs).toBe(1)
    expect(result.pairingConflicts).toEqual([[2, 3]])
    const duplicate = checkNotionReimport(plan, [existing('one', 2), existing('two', 2)])
    expect(duplicate.summary.conflictingRows).toBe(1)
  })

  it('checks the whole work group and never merges a title match automatically', async () => {
    const staging = stageNotionImport(plan)
    const conflict = checkNotionWorkCollisions(plan, staging, [libraryBook('one', '相同', 2), libraryBook('two', '相同', 3)])
    expect(conflict.summary.conflictingGroups).toBe(1)
    expect(conflict.groups[0]).toMatchObject({ kind: 'conflict', linkedBookIds: ['one', 'two'] })

    const linked = checkNotionWorkCollisions(plan, staging, [libraryBook('one', '相同', 2)])
    expect(linked.groups[0]).toMatchObject({ kind: 'linked', linkedBookIds: ['one'] })

    const manual = libraryBook('manual-comic', '相同')
    const review = await checkNotionWorkCollisionsInRepository(plan, staging, {
      books: { getAll: async () => [manual] }
    } as Parameters<typeof checkNotionWorkCollisionsInRepository>[2])
    expect(review.groups[0]).toMatchObject({ kind: 'review', linkedBookIds: [], possibleBookIds: ['manual-comic'], reason: 'title_match_requires_review' })
    expect(review.summary.existingBooksCompared).toBe(1)
    expect(review.comparisonScope).toBe('provided-book-repository')
    expect(review.formalWriteReady).toBe(false)
  })

  it('keeps unconfirmed work groupings for review, even when no title matches', () => {
    const proposed = buildNotionImportPlan(hash, rows, decisions, [], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }])
    const result = checkNotionWorkCollisions(proposed, stageNotionImport(proposed), [])
    expect(result.groups[0]).toMatchObject({ kind: 'review', reason: 'unconfirmed_grouping' })
    expect(result.summary.newGroups).toBe(0)
    const unpaired = buildNotionImportPlan(hash, rows, decisions)
    expect(checkNotionWorkCollisions(unpaired, stageNotionImport(unpaired), []).groups.map((group) => group.reason)).toEqual(['unpaired_same_work', 'unpaired_same_work'])
  })

  it('compares remote books and rejects malformed remote payloads without local fallback', async () => {
    const remoteBook = { ...libraryBook('remote-one', '相同', 2), createdAt: '2026-09-24T00:00:00.000Z', updatedAt: '2026-09-24T00:00:00.000Z', revision: 1, schemaVersion: 1 }
    const stored = { kind: 'book' as const, id: remoteBook.id, revision: 1, createdAt: '', updatedAt: '', schemaVersion: 1,
      provenance: remoteBook.provenance, deletedAt: null, payload: remoteBook }
    const remote = { list: async () => [stored] } as Parameters<typeof checkNotionWorkCollisionsInRemote>[2]
    const result = await checkNotionWorkCollisionsInRemote(plan, stageNotionImport(plan), remote)
    expect(result.groups[0].linkedBookIds).toEqual(['remote-one'])
    const invalid = { list: async () => [{ ...stored, payload: { id: 'remote-one', title: '相同' } }] } as unknown as Parameters<typeof checkNotionWorkCollisionsInRemote>[2]
    await expect(checkNotionWorkCollisionsInRemote(plan, stageNotionImport(plan), invalid)).rejects.toThrow('Remote book data is invalid')
  })
})
