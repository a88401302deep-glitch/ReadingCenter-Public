import { expect, it } from 'vitest'
import { parseReadmooMetadataText } from '../../src/domain/readmoo-metadata-text'
import { defaultMetadataFields, isMetadataSourceUrl } from '../../src/domain/book-metadata'
const url = 'https://readmoo.com/book/210304417000101'
it('separates author, original name, translator and illustrator from explicitly labelled pasted facts', () => {
 const { candidate } = parseReadmooMetadataText(`作者：史卡蕾特．娜希索 關注
插畫：史卡蕾特．娜希索 關注
原文作者：Scarlet Narciso 關注
譯者：陳怡婷 關注
出版社：大穎文化 關注
出版日期：2023/10/04
eISBN: 9786267367063 ISBN: 9786267367001
頁數：48
原文書名：El mejor regalo 原文語言：西班牙文`, url, '那麼，換我做點什麼呢？')
 expect(candidate).toMatchObject({ source: '讀墨（貼上文字）', authors: ['史卡蕾特．娜希索'], authorOriginalNames: ['Scarlet Narciso'], translators: ['陳怡婷'], illustrators: ['史卡蕾特．娜希索'], publisher: '大穎文化', isbn: '9786267367063', originalTitle: 'El mejor regalo', publishedOn: '2023-10-04', coverUrl: null })
 expect(candidate).not.toHaveProperty('wordCount')
 expect(defaultMetadataFields(candidate)).not.toContain('isbn')
 expect(defaultMetadataFields(candidate)).not.toContain('publishedOn')
 expect(isMetadataSourceUrl(candidate.sourceUrl)).toBe(true)
})
it('reads next-line values and explicit series/volume without guessing from title or biography', () => {
 const { candidate } = parseReadmooMetadataText('作者：\n甲、乙\n字數：\n66,554 字\n系列名稱：系列甲\n卷次：外傳\n作者介紹\n作者：不可混入\n系列名稱：其他系列', url, '第7集：測試')
 expect(candidate).toMatchObject({ authors: ['甲', '乙'], wordCount: 66554, seriesName: '系列甲', sequenceLabel: '外傳' })
 expect(defaultMetadataFields(candidate)).not.toContain('seriesName')
 expect(defaultMetadataFields(candidate)).not.toContain('sequenceLabel')
})
it('omits conflicting values and never fills electronic ISBN from a paper ISBN', () => {
 const { candidate, warnings } = parseReadmooMetadataText('作者：甲\n字數：100\n字數：200\nISBN：9786267367001\n頁數：48', url, '書')
 expect(candidate.isbn).toBe('')
 expect(candidate).not.toHaveProperty('wordCount')
 expect(warnings).toContain('字數有多個不同值，請手動核對')
})
it('rejects unsupported sources and excessive/empty/unlabelled/HTML input', () => {
 for (const target of ['javascript:alert(1)', 'https://readmoo.com.evil.test/book/210304417000101', 'https://u@readmoo.com/book/210304417000101', url + '?next=x', url + '#x', 'http://readmoo.com/book/210304417000101']) {
  expect(() => parseReadmooMetadataText('作者：甲', target, '書')).toThrow()
  expect(isMetadataSourceUrl(target)).toBe(false)
 }
 for (const input of ['', '這是沒有欄位標籤的簡介', 'x'.repeat(20001), '<script>alert(1)</script>']) expect(() => parseReadmooMetadataText(input, url, '書')).toThrow()
 expect(() => parseReadmooMetadataText('作者：甲', url, '')).toThrow()
 expect(() => parseReadmooMetadataText('書名：另一部書\n作者：甲', url, '這部書')).toThrow('書名')
 expect(parseReadmooMetadataText('作者：甲', 'https://console.readmoo.com/book/210304417000101/', '書').candidate.sourceUrl).toBe(url)
})
it('leaves malformed dates, approximate counts and title-only volume guesses out of candidates', () => {
 const { candidate, warnings } = parseReadmooMetadataText('作者：甲\n字數：約 6 萬\n出版日期：明年\n出版社：書房', url, '系列甲第3集')
 expect(candidate).not.toHaveProperty('wordCount')
 expect(candidate).not.toHaveProperty('seriesName')
 expect(candidate).not.toHaveProperty('sequenceLabel')
 expect(candidate.publishedOn).toBe('')
 expect(warnings.length).toBe(2)
})
