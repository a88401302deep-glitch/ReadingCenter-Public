import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { stageNotionImport } from '../../src/import/notion-staging'

const hash = 'a'.repeat(64)
const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,關聯生活點滴',
  '重複,作者,已讀完,0,,,2022/12/12,,',
  '重複,作者,已讀完,0,,,2022/12/31,,',
  '同作品,作者,尚未開始,0,,,,',
  '同作品,作者,已讀完,0,,,2024/02/14,,',
  '未知,作者,尚未開始,0,,,,,2024/02/15',
  ',,尚未開始,0,,,,'].join('\n')
const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
const decisions = Object.fromEntries([2, 3, 4, 5].map((rowNumber) => [rowNumber, { duplicate: 'same-work' as const }]))

describe('Notion import staging', () => {
  it('separates works from evidenced reading and suppresses only confirmed duplicate reading', () => {
    const plan = buildNotionImportPlan(hash, rows, decisions, [{ kind: 'same-reading', rowNumbers: [2, 3], keepCompletionFrom: 2 }], [{ kind: 'same-work-proposal', rowNumbers: [4, 5] }])
    const staged = stageNotionImport(plan)
    expect(staged.summary).toMatchObject({ sourceRows: 6, workGroups: 4, titledWorkGroups: 3, proposedWorkGroups: 1, deferredSourceRows: 0, readingCandidates: 3, datedCompletions: 2, sourceRowsWithoutReadingEvidence: 2 })
    expect(staged.readingCandidates[0]).toMatchObject({ sourceRowNumbers: [2, 3], completionDate: { completedOn: '2022-12-12' } })
    expect(staged.readingCandidates[1]).toMatchObject({ sourceRowNumbers: [5], completionDate: { completedOn: '2024-02-14' } })
    expect(staged.readingCandidates[2]).toMatchObject({ readingStage: 'undetermined', completionDate: null })
    expect(staged.workGroups[1]).toMatchObject({ decision: 'same-work-proposal', sourceRowNumbers: [4, 5] })
    expect(staged.formalWriteReady).toBe(false)
    expect(staged.prototypeBlockers).toEqual([{ sourceRowNumbers: [7], reason: 'missing_title' }, { sourceRowNumbers: [6], reason: 'unknown_reading_status' }])
  })

  it('leaves deferred rows as separate work candidates', () => {
    const plan = buildNotionImportPlan(hash, rows, decisions, [{ kind: 'defer', rowNumbers: [2, 3] }])
    expect(stageNotionImport(plan).summary.deferredSourceRows).toBe(2)
  })

  it('preserves rating, short review and long review flag without inventing review dates or text', () => {
    const csvWithReview = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,心得',
      '書,作者,已讀完,4,,,2024/02/14,短短的心得,Yes'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csvWithReview))
    const result = stageNotionImport(buildNotionImportPlan(hash, sourceRows, {}))
    expect(result.ratingCandidates).toMatchObject([{ sourceRowNumber: 2, rating: 4 }])
    expect(result.workGroups[0]).toMatchObject({ ratingProposal: { value: 4, scale: 5 }, conflictingRatings: false })
    expect(result.shortReviewCandidates).toMatchObject([{ sourceRowNumber: 2, text: '短短的心得', recordedForAt: null }])
    expect(result.longReviewFlags).toMatchObject([{ sourceRowNumber: 2, contentAvailable: false }])
    expect(result.summary).toMatchObject({ ratedSourceRows: 1, shortReviewSourceRows: 1, longReviewFlagSourceRows: 1 })
  })

  it('does not silently choose between two ratings for one proposed work', () => {
    const csvWithRatings = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得',
      '同作品,作者,已讀完,3,,,2024/02/14,', '同作品,作者,已讀完,4,,,2024/02/15,'].join('\n')
    const ratedRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csvWithRatings))
    const choices = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
    const plan = buildNotionImportPlan(hash, ratedRows, choices, [], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }])
    const staged = stageNotionImport(plan)
    expect(staged.workGroups[0]).toMatchObject({ ratingProposal: null, conflictingRatings: true })
    expect(staged.summary.workGroupsWithConflictingRatings).toBe(1)
    expect(staged.ratingCandidates.map((item) => item.rating)).toEqual([3, 4])
  })

  it('keeps reported days distinct from the date span and flags conflicting duplicate values', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,關聯生活點滴,閱讀時間',
      '甲,作者,已讀完,0,,,2024/02/01 → 2024/02/10,,,總共閱讀1天',
      '甲,作者,已讀完,0,,,2024/02/10,,,總共閱讀3天',
      '乙,作者,尚未開始,0,,,,,2024/02/11,總共閱讀0天'].join('\n')
    const sources = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const choices = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
    const plan = buildNotionImportPlan(hash, sources, choices, [{ kind: 'same-reading', rowNumbers: [2, 3], keepCompletionFrom: 2 }])
    const result = stageNotionImport(plan)
    expect(result.readingCandidates[0]).toMatchObject({ reportedReadingDays: null, conflictingReportedReadingDays: true })
    expect(result.readingCandidates[1]).toMatchObject({ reportedReadingDays: null, conflictingReportedReadingDays: false })
    expect(result.summary).toMatchObject({ withReportedReadingDays: 0, conflictingReportedReadingDays: 1 })
    expect(result.prototypeBlockers).toContainEqual({ sourceRowNumbers: [2, 3], reason: 'conflicting_reported_days' })
  })

  it('lists missing title and abandoned reason as separate import blockers', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,關聯生活點滴',
      ',,已讀完,0,,,2024/02/10,,', '甲,作者,棄坑,0,,,,,2024/02/11'].join('\n')
    const sources = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const result = stageNotionImport(buildNotionImportPlan(hash, sources, {}))
    expect(result.prototypeBlockers).toEqual([
      { sourceRowNumbers: [2], reason: 'missing_title' },
      { sourceRowNumbers: [3], reason: 'abandoned_reason_missing' }
    ])
    expect(result.summary.prototypeBlockedItems).toBe(2)
  })

  it('preserves publisher, category, tag and platform text per source row without splitting them', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,出版社,來源,網址',
      '同作品,作者,尚未開始,0,"溫馨療癒, 漫畫","人設讚, 燒腦",,,' + '東立出版社,讀墨,https://example.com/1',
      '同作品,作者,已讀完,0,網路\\原創小說,治癒,2024/02/14,,東立,網路,https://example.com/2'].join('\n')
    const sources = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const choices = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
    const result = stageNotionImport(buildNotionImportPlan(hash, sources, choices, [], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }]))
    expect(result.workGroups[0]).toMatchObject({
      publisherProposal: null, conflictingPublishers: true,
      sourceMetadata: [
        { sourceRowNumber: 2, authorText: '作者', publisher: '東立出版社', categoryText: '溫馨療癒, 漫畫', tagText: '人設讚, 燒腦', sourcePlatform: '讀墨', sourceUrl: 'https://example.com/1' },
        { sourceRowNumber: 3, authorText: '作者', publisher: '東立', categoryText: '網路\\原創小說', tagText: '治癒', sourcePlatform: '網路', sourceUrl: 'https://example.com/2' }
      ]
    })
    expect(result.summary).toMatchObject({ sourceRowsWithPublisher: 2, sourceRowsWithCategory: 2, sourceRowsWithTag: 2, sourceRowsWithPlatform: 2, workGroupsWithConflictingPublishers: 1 })
  })

  it('resolves two source publisher spellings to one verified display proposal while keeping both originals', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,出版社',
      '同作品,作者,尚未開始,0,,,,,皇冠文化有限公司',
      '同作品,作者,已讀完,0,,,2024/02/14,,皇冠文化'].join('\n')
    const sources = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const choices = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
    const result = stageNotionImport(buildNotionImportPlan(hash, sources, choices, [], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }]))
    expect(result.workGroups[0]).toMatchObject({ publisherProposal: null, publisherDisplayProposal: '皇冠', conflictingPublishers: true })
    expect(result.workGroups[0].sourceMetadata.map((source) => source.publisher)).toEqual(['皇冠文化有限公司', '皇冠文化'])
    expect(result.summary.sourceRowsWithPublisherDisplayProposal).toBe(2)
  })

  it('prefers title-verified bookstore data over the source publisher and rejects stale evidence', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,出版社',
      '都市型災害應變求生計畫,川口拓,已讀完,3,,,2024/04/23,,楓書坊文化出版社'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const plan = buildNotionImportPlan(hash, sourceRows, {})
    const evidence = { sourceTitle: '都市型災害應變求生計畫', sourcePublisher: '楓書坊文化出版社', displayName: '楓樹林出版社', evidenceUrl: 'https://www.books.com.tw/products/0010976915' }
    const staged = stageNotionImport(plan, { 2: evidence })
    expect(staged.workGroups[0]).toMatchObject({ publisherProposal: '楓書坊文化出版社', publisherDisplayProposal: '楓樹林出版社', sourceMetadata: [{ publisher: '楓書坊文化出版社', publisherDisplayProposal: '楓樹林出版社', publisherResolutionScope: 'verified-book' }] })
    expect(staged.summary.sourceRowsWithBookVerifiedPublisher).toBe(1)
    expect(() => stageNotionImport(plan, { 2: { ...evidence, sourceTitle: '另一本書' } })).toThrow('Publisher evidence does not match source row 2')
  })
})
