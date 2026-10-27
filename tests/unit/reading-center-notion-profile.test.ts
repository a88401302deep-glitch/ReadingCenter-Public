import { describe, expect, it } from 'vitest'
import {
  READING_CENTER_NOTION_MAPPING,
  createReadingCenterNotionPreview,
  selectRepresentativeNotionPreviewRows
} from '../../src/import'

const headers = ['書名', '作者', '閱讀', '評分', '主題', '標籤', '時間', '一行心得']

function csvRow(values: string[]): string {
  return values.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')
}

describe('ReadingCenter Notion source profile', () => {
  it('maps only verified columns and preserves unresolved values', () => {
    const csv = [
      headers.join(','),
      csvRow(['範例一', '作者甲', '已讀完', '0', '小說\\懸疑', '重讀, 療癒', '2026/09/01 → 2026/09/03', '短評'])
    ].join('\n')
    const preview = createReadingCenterNotionPreview(csv)

    expect(preview.mapping).toEqual(READING_CENTER_NOTION_MAPPING)
    expect(preview.rows[0].values).toMatchObject({
      title: '範例一',
      creator: '作者甲',
      status: '已讀完',
      rating: 0,
      categories: '小說\\懸疑',
      tags: '重讀, 療癒',
      readDates: '2026/09/01 → 2026/09/03',
      shortReview: '短評',
      mediaType: '',
      externalId: '',
      note: ''
    })
  })

  it('keeps duplicate title and creator rows together when the limit allows', () => {
    const csv = [
      headers.join(','),
      csvRow(['重讀作品', '作者甲', '已讀完', '4', '小說', '', '2025/01/01', '第一次']),
      csvRow(['普通作品', '作者乙', '尚未開始', '0', '小說', '', '', '']),
      csvRow(['重讀作品', '作者甲', '閱讀中', '5', '小說', '', '2026/01/01', '第二次'])
    ].join('\n')
    const preview = createReadingCenterNotionPreview(csv)
    const sample = selectRepresentativeNotionPreviewRows(preview, 3)

    expect(sample.map((row) => row.values.title)).toContain('重讀作品')
    expect(sample.filter((row) => row.values.title === '重讀作品')).toHaveLength(2)
    expect(sample[2].diagnostics.map(({ code }) => code)).toContain('duplicate_source_key')
  })

  it('samples diagnostics, distinct statuses, ratings, date shapes, and optional fields deterministically', () => {
    const sourceRows = [
      ['', '作者零', '', '文字分數', '', '', '', ''],
      ['作品一', '作者一', '尚未開始', '0', '小說', '', '', ''],
      ['作品二', '作者二', '閱讀中', '3', '漫畫', '追更', '2026/09/01', ''],
      ['作品三', '作者三', '暫停', '4', '小說', '', '2026/09/02 下午8:00 (GMT+8)', '一句話'],
      ['作品四', '作者四', '棄坑', '2', '網文', '', '2026/09/01 → 2026/09/04', ''],
      ['作品五', '作者五', '已讀完', '5', '雜誌', '', '不明日期', '']
    ]
    const csv = [headers.join(','), ...sourceRows.map(csvRow)].join('\n')
    const preview = createReadingCenterNotionPreview(csv)
    const first = selectRepresentativeNotionPreviewRows(preview, 6)
    const second = selectRepresentativeNotionPreviewRows(preview, 6)

    expect(first).toEqual(second)
    expect(first).toHaveLength(6)
    expect(new Set(first.map((row) => row.values.status))).toEqual(
      new Set(['', '尚未開始', '閱讀中', '暫停', '棄坑', '已讀完'])
    )
  })

  it('caps samples at 20 and validates the requested limit', () => {
    const rows = Array.from({ length: 30 }, (_, index) =>
      csvRow([`作品${index}`, `作者${index}`, '尚未開始', '0', '小說', '', '', ''])
    )
    const preview = createReadingCenterNotionPreview([headers.join(','), ...rows].join('\n'))

    expect(selectRepresentativeNotionPreviewRows(preview)).toHaveLength(20)
    expect(() => selectRepresentativeNotionPreviewRows(preview, 0)).toThrow(RangeError)
    expect(() => selectRepresentativeNotionPreviewRows(preview, 21)).toThrow(RangeError)
  })
})
