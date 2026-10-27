import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'

const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,喜好,關聯生活點滴,Created time',
  '有日期,,閱讀中,0,,,2026/09/01,,,,2026年8月1日',
  '有日誌,,已讀完,0,,,,,,2026/09/02,2026年8月1日',
  '無證據,,已讀完,0,,,,,,,2026年8月1日'].join('\n')
const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
const hash = 'a'.repeat(64)

describe('Notion import plan preview', () => {
  it('resolves reviewed dates and preserves source values without inventing events', () => {
    const plan = buildNotionImportPlan(hash, rows, { 2: { date: 'keep-source' } })
    expect(plan).toMatchObject({ formalWriteReady: false, sourceIdentityScope: 'csv-snapshot-and-row-number' })
    expect(plan.summary).toMatchObject({ readingEvidenceRows: 2, datedCompletionRows: 0, uncorroboratedCompletedRows: 1 })
    expect(plan.items[0]).toMatchObject({ sourceRowKey: `${hash}:2`, suggested: { status: 'reading', completionDate: null, hasReadingEvidence: true } })
    expect(plan.items[0].source['時間']).toBe('2026/09/01')
    expect(plan.items[1].suggested).toMatchObject({ status: 'completed', hasReadingEvidence: true, evidence: { time: false, dailyRelation: true } })
    expect(plan.items[2].suggested.hasReadingEvidence).toBe(false)
    expect(plan.items[2].suggested.rating).toBeNull()
    expect(plan.items.every((item) => !('activityLog' in item))).toBe(true)
  })

  it('counts an accepted completion date without treating a row key as a permanent Notion ID', () => {
    const plan = buildNotionImportPlan(hash, rows, { 2: { date: 'use-completion-date' } })
    expect(plan.summary.datedCompletionRows).toBe(1)
    expect(plan.items[0].suggested.completionDate).toMatchObject({ completedOn: '2026-09-01' })
  })

  it('records confirmed duplicate reading separately from source rows', () => {
    const duplicateCsv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,喜好,關聯生活點滴,封面',
      '甲,作者,已讀完,0,,,2022/12/12,,,,cover one.jpg',
      '甲,作者,已讀完,0,,,2022/12/31,,,,cover two.jpg'].join('\n')
    const duplicateRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(duplicateCsv))
    const choices = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
    const plan = buildNotionImportPlan(hash, duplicateRows, choices, [{ kind: 'same-reading', rowNumbers: [2, 3], keepCompletionFrom: 2 }])
    expect(plan.summary).toMatchObject({ readingEvidenceRows: 2, datedCompletionRows: 2, confirmedUniqueReadingRecords: 1, confirmedUniqueDatedCompletions: 1 })
    expect(plan.items[0].coverReferences).toEqual([{ kind: 'local-export-file', value: 'cover one.jpg' }])
    expect(plan.pairingResolutions[0]).toMatchObject({ kind: 'same-reading', keepCompletionFrom: 2 })
    expect(() => buildNotionImportPlan(hash, duplicateRows, choices, [{ kind: 'same-reading', rowNumbers: [2, 3], keepCompletionFrom: 4 }])).toThrow()
  })

  it('keeps a same-work proposal distinct from a confirmed duplicate reading', () => {
    const sources = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得',
      '甲,作者,尚未開始,0,,,,', '甲,作者,已讀完,0,,,2024/02/14,'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(sources))
    const choices = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
    const result = buildNotionImportPlan(hash, sourceRows, choices, [], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }])
    expect(result.summary).toMatchObject({ readingEvidenceRows: 1, confirmedUniqueReadingRecords: 1, datedCompletionRows: 1 })
    expect(result.workGroupingProposals).toEqual([{ kind: 'same-work-proposal', rowNumbers: [2, 3] }])
    expect(result.items).toHaveLength(2)
    expect(() => buildNotionImportPlan(hash, sourceRows, choices, [{ kind: 'defer', rowNumbers: [2, 3] }], [{ kind: 'same-work-proposal', rowNumbers: [2, 3] }])).toThrow()
  })

  it('keeps source-reported reading days even when they differ from calendar span', () => {
    const data = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,閱讀時間', '甲,,已讀完,0,,,2024/02/01 → 2024/02/10,,總共閱讀1天', '乙,,尚未開始,0,,,,,總共閱讀0天'].join('\n')
    const sourceRows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(data))
    const result = buildNotionImportPlan(hash, sourceRows, {})
    expect(result.items.map((item) => item.suggested.recordedReadingDays)).toEqual([1, 0])
    expect(result.items[0].suggested.completionDate).toMatchObject({ completedOn: '2024-02-10' })
  })
})
