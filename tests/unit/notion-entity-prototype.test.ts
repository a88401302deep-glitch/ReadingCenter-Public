import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { buildNotionCoverManifest } from '../../src/import/notion-cover-manifest'
import { stageNotionImport } from '../../src/import/notion-staging'
import { buildNotionEntityPrototype } from '../../src/import/notion-entity-prototype'

const hash = 'a'.repeat(64)
const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,關聯生活點滴,閱讀時間',
  '甲,作者,已讀完,4,,,2024/02/22 → 2024/02/25,讀後感,,總共閱讀1天',
  '甲,作者,尚未開始,0,,,,,,總共閱讀0天',
  '乙,作者,尚未開始,0,,,,,2024/02/26,總共閱讀0天'].join('\n')
const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
const choices = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
const plan = buildNotionImportPlan(hash, rows, choices, [], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }])
const staged = stageNotionImport(plan)

describe('Notion entity prototype', () => {
  it('preserves date precision, rating and short review without creating activity time', () => {
    const result = buildNotionEntityPrototype(plan, staged, [2, 3, 4], '2026-09-23T00:00:00.000Z')
    expect(result.summary).toEqual({ selectedSourceRows: 3, bookPrototypes: 2, authorPrototypes: 1, publisherPrototypes: 0, publisherNamesFromStorefront: 0, categoryPrototypes: 0, tagPrototypes: 0, sourcePrototypes: 0, externalLinkCandidates: 0, coverImportCandidates: 0, coverSelectionNeeded: 0, externalCoverCandidates: 0, cyclePrototypes: 1, shortReviewPrototypes: 1, blockedItems: 1, fabricatedReadingRecords: 0 })
    expect(result.books[0]).toMatchObject({ rating: { value: 4, scale: 5 }, cover: null, externalReferences: [{ externalId: `${hash}:2` }, { externalId: `${hash}:3` }] })
    expect(result.unmappedBookMetadata[0]).toMatchObject({ bookId: result.books[0].id, sourceMetadata: [{ sourceRowNumber: 2 }, { sourceRowNumber: 3 }] })
    expect(result.readingCycles[0]).toMatchObject({ startedAt: null, finishedAt: null, reportedReadingDays: 1, completionDate: { precision: 'range', startedOn: '2024-02-22', completedOn: '2024-02-25' } })
    expect(result.readingContents[0]).toMatchObject({ type: 'shortReview', recordedForAt: null, text: '讀後感' })
    expect(result.blocked).toEqual([{ sourceRowNumbers: [4], reason: 'unknown_reading_status' }])
    expect(result.formalWriteReady).toBe(false)
  })

  it('rejects a partial same-work group', () => {
    expect(() => buildNotionEntityPrototype(plan, staged, [2], '2026-09-23T00:00:00.000Z')).toThrow('every source row')
  })

  it('links selected categories and tags to the book while retaining untouched source text', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得',
      '甲,作者,尚未開始,0,"溫馨療癒, 漫畫","人設讚, 燒腦",,',
      '乙,作者,尚未開始,0,漫畫,燒腦,,'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const sourcePlan = buildNotionImportPlan(hash, sourceRows, {})
    const sourceStage = stageNotionImport(sourcePlan)
    const result = buildNotionEntityPrototype(sourcePlan, sourceStage, [2, 3], '2026-09-23T00:00:00.000Z')
    expect(result.dictionaryEntries.filter((entry) => entry.kind === 'category' || entry.kind === 'tag').map(({ kind, name }) => [kind, name])).toEqual([
      ['category', '溫馨療癒'], ['category', '漫畫'], ['tag', '人設讚'], ['tag', '燒腦']
    ])
    expect(result.books[0].categoryIds).toHaveLength(2)
    expect(result.books[0].tagIds).toHaveLength(2)
    expect(result.books[1].categoryIds).toEqual([result.books[0].categoryIds[1]])
    expect(result.books[1].tagIds).toEqual([result.books[0].tagIds[1]])
    expect(result.unmappedBookMetadata[0].sourceMetadata[0]).toMatchObject({ categoryText: '溫馨療癒, 漫畫', tagText: '人設讚, 燒腦' })
  })

  it('links plain authors and source platforms while keeping external URLs separate', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,來源,網址',
      '甲,高木直子,尚未開始,0,,,,,讀墨,https://readmoo.com/book/123',
      '乙,https://readmoo.com/contributor/456,尚未開始,0,,,,,讀墨,https://readmoo.com/book/456'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const sourcePlan = buildNotionImportPlan(hash, sourceRows, {})
    const result = buildNotionEntityPrototype(sourcePlan, stageNotionImport(sourcePlan), [2, 3], '2026-09-23T00:00:00.000Z')
    expect(result.summary).toMatchObject({ authorPrototypes: 1, sourcePrototypes: 1, externalLinkCandidates: 2 })
    expect(result.books[0].authorIds).toHaveLength(1)
    expect(result.books[1].authorIds).toEqual([])
    expect(result.books[0].sourceIds).toEqual(result.books[1].sourceIds)
    expect(result.externalLinkCandidates).toEqual([
      { bookId: result.books[0].id, sourceRowNumber: 2, url: 'https://readmoo.com/book/123' },
      { bookId: result.books[1].id, sourceRowNumber: 3, url: 'https://readmoo.com/book/456' }
    ])
    expect(result.unmappedBookMetadata[1].sourceMetadata[0].authorText).toBe('https://readmoo.com/contributor/456')
  })

  it('uses the agreed bookstore publisher name for a book and retains original source spellings', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,出版社',
      '同作品,作者,尚未開始,0,,,,,皇冠文化有限公司',
      '同作品,作者,尚未開始,0,,,,,皇冠文化',
      '另一作品,作者,尚未開始,0,,,,,原始出版單位'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const choices = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
    const sourcePlan = buildNotionImportPlan(hash, sourceRows, choices, [], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }])
    const result = buildNotionEntityPrototype(sourcePlan, stageNotionImport(sourcePlan), [2, 3, 4], '2026-09-23T00:00:00.000Z')
    expect(result.summary).toMatchObject({ publisherPrototypes: 2, publisherNamesFromStorefront: 1 })
    expect(result.dictionaryEntries.filter((entry) => entry.kind === 'publisher').map((entry) => entry.name)).toEqual(['皇冠', '原始出版單位'])
    expect(result.books[0].publisherId).toBe(result.dictionaryEntries.find((entry) => entry.kind === 'publisher' && entry.name === '皇冠')?.id)
    expect(result.unmappedBookMetadata[0].sourceMetadata.map((item) => item.publisher)).toEqual(['皇冠文化有限公司', '皇冠文化'])
  })

  it('prefers a matching book-level bookstore correction over an incorrect source publisher', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,出版社',
      '災害應變,川口拓,已讀完,3,,,2024/04/23,,楓書坊文化出版社'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const sourcePlan = buildNotionImportPlan(hash, sourceRows, {})
    const sourceStage = stageNotionImport(sourcePlan, { 2: {
      sourceTitle: '災害應變', sourcePublisher: '楓書坊文化出版社', displayName: '楓樹林出版社', evidenceUrl: 'https://www.books.com.tw/products/0010976915'
    } })
    const result = buildNotionEntityPrototype(sourcePlan, sourceStage, [2], '2026-09-23T00:00:00.000Z')
    expect(result.dictionaryEntries.find((entry) => entry.kind === 'publisher')?.name).toBe('楓樹林出版社')
    expect(result.books[0].publisherId).toBe(result.dictionaryEntries.find((entry) => entry.kind === 'publisher')?.id)
    expect(result.unmappedBookMetadata[0].sourceMetadata[0]).toMatchObject({ publisher: '楓書坊文化出版社', publisherDisplayProposal: '楓樹林出版社', publisherResolutionScope: 'verified-book' })
  })

  it('lists matched archive covers without assigning a path before files are copied', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,封面',
      '甲,作者,尚未開始,0,,,,,one.jpg',
      '乙,作者,尚未開始,0,,,,,"two.jpg, alternate.jpg"',
      '丙,作者,尚未開始,0,,,,,https://example.com/cover.jpg'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const sourcePlan = buildNotionImportPlan(hash, sourceRows, {})
    const sourceStage = stageNotionImport(sourcePlan)
    const manifest = buildNotionCoverManifest(sourceStage, ['one.jpg', 'two.jpg', 'alternate.jpg'])
    const result = buildNotionEntityPrototype(sourcePlan, sourceStage, [2, 3, 4], '2026-09-23T00:00:00.000Z', manifest)
    expect(result.summary).toMatchObject({ coverImportCandidates: 1, coverSelectionNeeded: 1, externalCoverCandidates: 1 })
    expect(result.coverImportCandidates).toEqual([{ bookId: result.books[0].id, sourceRowNumbers: [2], archiveFile: 'one.jpg', status: 'awaiting-file-copy' }])
    expect(result.coverSelectionNeeded).toEqual([{ bookId: result.books[1].id, sourceRowNumbers: [3], archiveFiles: ['two.jpg', 'alternate.jpg'] }])
    expect(result.externalCoverCandidates).toEqual([{ bookId: result.books[2].id, sourceRowNumber: 4, url: 'https://example.com/cover.jpg', status: 'awaiting-download' }])
    expect(result.books.map((book) => book.cover)).toEqual([null, null, null])
    expect(() => buildNotionEntityPrototype(sourcePlan, sourceStage, [2, 3, 4], '2026-09-23T00:00:00.000Z', { ...manifest, csvSha256: 'b'.repeat(64) })).toThrow('different import')
  })
})
