import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { compareNotionSnapshots } from '../../src/import/notion-snapshot-comparison'

const headers = '書名,作者,閱讀,評分,主題,標籤,時間,一行心得,封面'
const plan = (hash: string, lines: string[]) => buildNotionImportPlan(hash, normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview([headers, ...lines].join('\n'))), {})
const old = plan('a'.repeat(64), ['甲,作者,已讀完,0,,,2022/12/12,,old.jpg', '乙,作者,已讀完,0,,,2022/12/31,,other.jpg'])

describe('comparison between Notion export snapshots', () => {
  it('suggests unique unchanged records despite reordered rows or renamed cover files', () => {
    const next = plan('b'.repeat(64), ['乙,作者,已讀完,0,,,2022/12/31,,new.jpg', '甲,作者,已讀完,0,,,2022/12/12,,different.jpg'])
    const result = compareNotionSnapshots(old, next)
    expect(result.summary).toEqual({ uniqueContentCandidates: 2, ambiguousRows: 0, unmatchedRows: 0 })
    expect(result.matches.map((item) => item.previousRowNumbers)).toEqual([[3], [2]])
    expect(result.formalWriteReady).toBe(false)
  })

  it('leaves edited or indistinguishable records unresolved', () => {
    const next = plan('c'.repeat(64), ['甲,作者,已讀完,0,,,2022/12/13,,old.jpg', '乙,作者,已讀完,0,,,2022/12/31,,one.jpg', '乙,作者,已讀完,0,,,2022/12/31,,two.jpg'])
    expect(compareNotionSnapshots(old, next).summary).toEqual({ uniqueContentCandidates: 0, ambiguousRows: 2, unmatchedRows: 1 })
  })
})
