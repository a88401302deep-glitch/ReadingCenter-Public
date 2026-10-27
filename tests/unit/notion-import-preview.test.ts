import { describe, expect, it } from 'vitest'
import {
  NotionImportConfigurationError,
  createNotionImportPreview,
  parseNotionCsv
} from '../../src/import'

describe('Notion CSV import preview', () => {
  it('parses BOM, CRLF, quoted commas, escaped quotes, and multiline cells', () => {
    const document = parseNotionCsv(
      '\uFEFF書名,作者,心得\r\n' +
      '"唐草人偶","梨木香步","溫柔,但不輕飄"\r\n' +
      '"第二本","作者 ""甲""","第一行\n第二行"\r\n'
    )

    expect(document.headers).toEqual(['書名', '作者', '心得'])
    expect(document.rows).toHaveLength(2)
    expect(document.rows[0].raw).toEqual({
      書名: '唐草人偶',
      作者: '梨木香步',
      心得: '溫柔,但不輕飄'
    })
    expect(document.rows[1].raw.作者).toBe('作者 "甲"')
    expect(document.rows[1].raw.心得).toBe('第一行\n第二行')
  })

  it('requires explicit mappings and preserves raw rows in the preview', () => {
    const document = parseNotionCsv(
      '名稱,創作者,分數,Notion ID\n' +
      '唐草人偶,梨木香步,4.5,page-1\n'
    )
    const preview = createNotionImportPreview(document, {
      title: '名稱',
      creator: '創作者',
      rating: '分數',
      externalId: 'Notion ID'
    })

    expect(preview.summary).toEqual({ total: 1, valid: 1, withErrors: 0, withWarnings: 0 })
    expect(preview.rows[0]).toMatchObject({
      sourceKey: 'external:page-1',
      values: {
        title: '唐草人偶',
        creator: '梨木香步',
        rating: 4.5,
        externalId: 'page-1'
      },
      raw: { 名稱: '唐草人偶', 創作者: '梨木香步', 分數: '4.5', 'Notion ID': 'page-1' }
    })
  })

  it('reports row errors and warnings without discarding source values', () => {
    const document = parseNotionCsv(
      '名稱,作者,評分\n' +
      ',無名氏,高分\n' +
      '同名書,甲,5\n' +
      '同名書,甲,4\n'
    )
    const preview = createNotionImportPreview(document, {
      title: '名稱',
      creator: '作者',
      rating: '評分'
    })

    expect(preview.summary).toEqual({ total: 3, valid: 1, withErrors: 1, withWarnings: 2 })
    expect(preview.rows[0].diagnostics.map(({ code }) => code)).toEqual([
      'empty_title',
      'invalid_rating'
    ])
    expect(preview.rows[0].raw.評分).toBe('高分')
    expect(preview.rows[2].diagnostics.map(({ code }) => code)).toEqual([
      'duplicate_source_key'
    ])
  })

  it('produces the same preview for the same source and mapping', () => {
    const document = parseNotionCsv('名稱,作者\n唐草人偶,梨木香步\n')
    const mapping = { title: '名稱', creator: '作者' }

    expect(createNotionImportPreview(document, mapping)).toEqual(
      createNotionImportPreview(document, mapping)
    )
  })

  it('stops preview generation for invalid headers or mappings', () => {
    const duplicateHeaders = parseNotionCsv('名稱,名稱\n第一本,第二本\n')
    expect(() => createNotionImportPreview(duplicateHeaders, {
      title: '名稱'
    })).toThrow(NotionImportConfigurationError)

    const blankHeader = parseNotionCsv('名稱,\n第一本,未命名欄位\n')
    expect(() => createNotionImportPreview(blankHeader, {
      title: '名稱'
    })).toThrow(NotionImportConfigurationError)

    const document = parseNotionCsv('名稱,作者\n唐草人偶,梨木香步\n')
    expect(() => createNotionImportPreview(document, {
      title: '不存在的欄位'
    })).toThrow(NotionImportConfigurationError)
  })

  it('reports column-count mismatches and rejects unclosed quotes', () => {
    const document = parseNotionCsv('名稱,作者\n第一本\n')
    expect(document.diagnostics).toEqual([
      expect.objectContaining({ code: 'column_count_mismatch', rowNumber: 2 })
    ])
    expect(() => parseNotionCsv('名稱,心得\n第一本,"未結束')).toThrow(
      'unclosed quoted field'
    )
  })
})
