import { expect, it } from 'vitest'
import { findMoonBookCandidates, moonDayDate, moonSourceTitle } from '../../src/import/moon-book-matching'
const book = (title: string, author: string, path: string) => ({ title, author, path, coverPath: null })
it('retains numeric titles and extracts bracketed source names', () => {
  expect(moonSourceTitle('/books/52個測試.txt')).toBe('52個測試')
  expect(moonSourceTitle('/books/作者《小說》.txt')).toBe('小說')
})
it('uses same-device exact paths ahead of unrelated titles', () => {
  const candidates = findMoonBookCandidates('/book.epub', 'one', [{ deviceId: 'one', books: [book('Original', 'A', '/book.epub')] }, { deviceId: 'two', books: [book('Other', 'B', '/book.epub')] }])
  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({ title: 'Original', evidence: '完整路徑' })
})
it('suggests renamed TXT versus EPUB titles and groups replicas without merging readings', () => {
  const books = [book('小說名稱', '作者', '/new/作者《小說名稱》.epub')]
  const candidates = findMoonBookCandidates('/old/小說名稱.txt', 'one', [{ deviceId: 'one', books }, { deviceId: 'two', books }])
  expect(candidates).toHaveLength(1)
  expect(candidates[0]).toMatchObject({ evidence: '同書名', sources: [{ deviceId: 'one', path: books[0].path }, { deviceId: 'two', path: books[0].path }] })
})
it('keeps collection editions and different authors as distinct suggestions', () => {
  const catalogs = [{ deviceId: 'one', books: [book('作品合集（全14冊）', 'A', '/14.epub'), book('作品合集（全18冊）', 'A', '/18.epub')] }]
  expect(findMoonBookCandidates('/作品合集.epub', 'one', catalogs)).toHaveLength(2)
  expect(findMoonBookCandidates('/同名小說.txt', 'one', [{ deviceId: 'one', books: [book('同名小說', 'A', '/a.epub'), book('同名小說', 'B', '/b.epub')] }])).toHaveLength(2)
})
it('does not match short title fragments to unrelated books or invent missing metadata', () => {
  expect(findMoonBookCandidates('/凶宅.epub', 'one', [{ deviceId: 'one', books: [book('凶宅怪談', 'A', '/a.epub')] }])).toEqual([])
  expect(findMoonBookCandidates('/missing.txt', 'one', [])).toEqual([])
})
it('converts calendar days with the verified offset without rounding or time-zone shifts', () => {
  expect(moonDayDate(20697)).toBe('2026-09-02')
  expect(moonDayDate(20667)).toBe('2026-08-03')
  for (const invalid of [-1, 1.5, Number.MAX_SAFE_INTEGER]) expect(() => moonDayDate(invalid)).toThrow()
})
