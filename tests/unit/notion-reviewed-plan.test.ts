import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { parseReviewedNotionPlan } from '../../src/import/notion-reviewed-plan'

const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得',
  '相同,甲,已讀完,0,,,2022/12/12,', '相同,甲,已讀完,0,,,2022/12/31,'].join('\n')
const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
const hash = 'a'.repeat(64)
const decisions = { 2: { duplicate: 'same-work' as const }, 3: { duplicate: 'same-work' as const } }
const plan = buildNotionImportPlan(hash, rows, decisions, [{ kind: 'same-reading', rowNumbers: [2, 3], keepCompletionFrom: 2 }])

describe('reviewed Notion plan upload', () => {
  it('rebuilds confirmed pairings from current CSV and review choices', () => {
    expect(parseReviewedNotionPlan(JSON.stringify(plan), hash, rows, decisions)).toEqual(plan)
  })

  it('rejects a changed source row, mismatched review decisions, or other CSV', () => {
    const changed = structuredClone(plan)
    changed.items[0].source['書名'] = '其他作品'
    expect(() => parseReviewedNotionPlan(JSON.stringify(changed), hash, rows, decisions)).toThrow('來源列')
    expect(() => parseReviewedNotionPlan(JSON.stringify(plan), hash, rows, {})).toThrow('核對選擇')
    expect(() => parseReviewedNotionPlan(JSON.stringify(plan), 'b'.repeat(64), rows, decisions)).toThrow('CSV')
  })

  it('rejects overlapping and forged pairs', () => {
    const invalid = { ...plan, pairingResolutions: [{ kind: 'same-reading', rowNumbers: [2, 2], keepCompletionFrom: 2 }] }
    expect(() => parseReviewedNotionPlan(JSON.stringify(invalid), hash, rows, decisions)).toThrow('核對選擇')
  })
})
