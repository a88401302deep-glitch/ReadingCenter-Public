import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { parseNotionReviewFile, resolveNotionReviewRows, serializeNotionReviewFile } from '../../src/import/notion-review-file'

const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,喜好',
  '同名,作者,閱讀中,0,小說,,2026/09/01,,',
  '同名,作者,已讀完,4,漫畫,,2025/09/02,,★★★★'].join('\n')
const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
const sha = 'a'.repeat(64)

describe('Notion review file', () => {
  it('restores decisions only for the exact same CSV and eligible source rows', () => {
    const serialized = serializeNotionReviewFile(sha, rows, {
      2: { date: 'use-completion-date', duplicate: 'separate' },
      3: { duplicate: 'same-work' }
    })
    expect(parseNotionReviewFile(serialized, sha, rows)).toEqual({
      2: { date: 'use-completion-date', duplicate: 'separate' },
      3: { duplicate: 'same-work' }
    })
    expect(() => parseNotionReviewFile(serialized, 'b'.repeat(64), rows)).toThrow('不相符')
    expect(() => parseNotionReviewFile(serialized, sha, rows.slice(0, 1))).toThrow('不相符')
  })

  it('rejects forged or duplicated row choices without partially restoring anything', () => {
    const valid = JSON.parse(serializeNotionReviewFile(sha, rows, { 2: { date: 'keep-source' } }))
    valid.decisions.push({ rowNumber: 2, duplicate: 'separate' })
    expect(() => parseNotionReviewFile(JSON.stringify(valid), sha, rows)).toThrow('重複')
    valid.decisions = [{ rowNumber: 3, date: 'keep-source' }]
    expect(() => parseNotionReviewFile(JSON.stringify(valid), sha, rows)).toThrow('不適用')
  })

  it('keeps the original status and leaves duplicate matches unresolved for later pairing', () => {
    const resolved = resolveNotionReviewRows(rows, { 2: { date: 'keep-source', duplicate: 'same-work' }, 3: { duplicate: 'separate' } })
    expect(resolved[0]).toMatchObject({ status: 'reading', completionDate: null, duplicate: 'same-work', pendingReviewCodes: [] })
    expect(resolved[1]).toMatchObject({ status: 'completed', duplicate: 'separate', pendingReviewCodes: [] })
    expect(rows[0].proposed.status).toBe('completed')
    expect(rows[0].proposed.completionDate).not.toBeNull()
  })

  it('applies an explicitly accepted completion date without changing the original row', () => {
    const resolved = resolveNotionReviewRows(rows, { 2: { date: 'use-completion-date' } })
    expect(resolved[0]).toMatchObject({ status: 'completed', completionDate: { completedOn: '2026-09-01' } })
    expect(resolved[0].pendingReviewCodes).toContain('duplicate_candidate')
    expect(rows[0].source.values.status).toBe('閱讀中')
  })
})
