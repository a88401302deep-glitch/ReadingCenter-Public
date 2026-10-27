import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'

const headers = '書名,作者,閱讀,評分,主題,標籤,時間,一行心得,喜好'
const row = (values: string[]) => values.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')
const preview = (...rows: string[][]) => normalizeReadingCenterNotionPreview(
  createReadingCenterNotionPreview([headers, ...rows.map(row)].join('\n'))
)

describe('real Notion normalization suggestions', () => {
  it('uses only Time or daily-life links as evidence of reading', () => {
    const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,喜好,關聯生活點滴,Created time,閱讀時間',
      '有日期,,已讀完,0,,,2026/09/01,,,,2026年8月1日,總共閱讀1天',
      '有日誌,,閱讀中,0,,,,,,2026/09/02,2026年8月1日,總共閱讀1天',
      '僅有建頁日,,已讀完,0,,,,,,,2026年8月1日,總共閱讀1天'].join('\n')
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
    expect(rows.map((item) => item.readingEvidence)).toEqual([
      { hasRead: true, fromTime: true, fromDailyRelation: false },
      { hasRead: true, fromTime: false, fromDailyRelation: true },
      { hasRead: false, fromTime: false, fromDailyRelation: false }
    ])
    expect(rows[2].source.values.status).toBe('已讀完')
  })
  it('preserves zeros as unrated and flags contradictory star values', () => {
    const [unrated, conflict, rated] = preview(
      ['甲', '作者甲', '尚未開始', '0', '', '', '', '', ''],
      ['乙', '作者乙', '閱讀中', '0', '', '', '', '', '★'],
      ['丙', '作者丙', '已讀完', '4', '', '', '2026/09/01', '', '★★★★']
    )
    expect(unrated.proposed).toMatchObject({ status: 'planned', rating: null })
    expect(conflict.proposed.rating).toBeNull()
    expect(conflict.reviewCodes).toContain('zero_rating_conflict')
    expect(rated.proposed).toMatchObject({ status: 'completed', rating: 4 })
  })

  it('parses dates without fabricating reading sessions or duration', () => {
    const [day, range, midnight, noon, invalid] = preview(
      ['甲', '', '閱讀中', '3', '', '', '2026/09/01', '', '★★★'],
      ['乙', '', '已讀完', '4', '', '', '2026/08/31 → 2026/09/02', '', '★★★★'],
      ['丙', '', '閱讀中', '0', '', '', '2026/09/01 上午12:05 (GMT+8)', '', ''],
      ['丁', '', '閱讀中', '0', '', '', '2026/09/01 下午12:30 (GMT+8)', '', ''],
      ['戊', '', '已讀完', '0', '', '', '2026/02/29', '', '']
    )
    expect(day.proposed.completionDate).toEqual({ precision: 'date', completedOn: '2026-09-01' })
    expect(range.proposed.completionDate).toEqual({ precision: 'range', startedOn: '2026-08-31', completedOn: '2026-09-02' })
    expect(range.reviewCodes).not.toContain('completion_date_status_conflict')
    expect(midnight.proposed.completionDate).toMatchObject({ precision: 'minute', localTime: '00:05', offsetMinutes: 480 })
    expect(noon.proposed.completionDate).toMatchObject({ precision: 'minute', localTime: '12:30' })
    expect(invalid.proposed.completionDate).toBeNull()
    expect(day.reviewCodes).toContain('completion_date_status_conflict')
    expect(day.proposed.status).toBe('completed')
    expect(day.source.values.status).toBe('閱讀中')
    expect(invalid.reviewCodes).toEqual(expect.arrayContaining(['invalid_date', 'completed_without_date']))
  })

  it('holds ambiguous statuses, URL authors, and both sides of duplicate groups for review', () => {
    const [first, second, paused, serial, abandoned] = preview(
      ['重讀', '作者', '已讀完', '5', '小說\\推理', '', '2025/01/01', '', '★★★★★'],
      ['重讀', '作者', '閱讀中', '0', '漫畫', '', '2026/09/01', '', ''],
      ['暫停作品', 'https://example.org/a', '暫停', '0', '', '', '', '', ''],
      ['連載作品', '作者', '閱讀(連載)', '4', '', '', '', '', '★★★★'],
      ['棄讀作品', '作者', '棄坑', '0', '', '', '', '', '']
    )
    expect(first.reviewCodes).toEqual(expect.arrayContaining(['duplicate_candidate', 'category_delimiter']))
    expect(second.reviewCodes).toContain('duplicate_candidate')
    expect(first.source.values.categories).not.toBe(second.source.values.categories)
    expect(paused.proposed).toMatchObject({ creator: null, status: 'paused' })
    expect(paused.reviewCodes).toContain('author_url')
    expect(serial.proposed.status).toBe('reading')
    expect(serial.reviewCodes).toContain('serial_status')
    expect(abandoned.proposed.status).toBe('abandoned')
    expect(abandoned.source.raw['閱讀']).toBe('棄坑')
  })
})
