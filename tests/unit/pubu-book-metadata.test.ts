import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { parsePubuBook, pubuBookId } from '../../worker/pubu-book-metadata'
import { handleBookMetadataSearch } from '../../worker/book-metadata-search'
import { defaultMetadataFields, isBookMetadataCandidate, isMetadataSourceUrl } from '../../src/domain/book-metadata'
const html = readFileSync(new URL('../fixtures/book-metadata/pubu-697279.html', import.meta.url), 'utf8')
it('reads the visible ebook ISBN instead of the conflicting paper ISBN in JSON-LD', () => {
 const candidate = parsePubuBook(html, '697279')
 expect(candidate).toMatchObject({ source: 'Pubu', authors: ['蝴蝶'], publisher: '春光出版', isbn: '9786267935583', publishedOn: '2026-09-29', wordCount: 67559, seriesName: '幻影都城', coverUrl: '/api/v1/books/metadata/cover?pubu=%2Fdocs%2F595849%2F19949%2FcfkPx9_l.jpg' })
 expect(isBookMetadataCandidate(candidate)).toBe(true)
 expect(defaultMetadataFields(candidate)).toContain('wordCount')
 expect(defaultMetadataFields(candidate)).not.toContain('isbn')
 expect(defaultMetadataFields(candidate)).not.toContain('publishedOn')
 expect(defaultMetadataFields(candidate)).not.toContain('seriesName')
 expect(candidate).not.toHaveProperty('sequenceLabel')
 expect(candidate).not.toHaveProperty('illustrators')
})
it('leaves absent fields empty and does not fall back to the JSON-LD paper ISBN or biography', () => {
 const candidate = parsePubuBook(html.replaceAll('<span>ISBN</span>', '<span>Unknown</span>').replace('67,559', 'unknown'), '697279')
 expect(candidate.isbn).toBe('')
 expect(candidate).not.toHaveProperty('wordCount')
 expect(() => parsePubuBook(html, '123')).toThrow()
})
it('fetches one canonical page without forwarding cookies, using Google or storing anything', async () => {
 const fetcher = vi.fn(async (url, init) => {
  expect(String(url)).toBe('https://www.pubu.com.tw/ebook/697279')
  expect(init.redirect).toBe('manual')
  expect(new Headers(init.headers).has('Cookie')).toBe(false)
  return new Response(html)
 })
 const result = await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=pubu&url=https%3A%2F%2Fwww.pubu.com.tw%2Febook%2F697279', { headers: { Cookie: 'session=private' } }), 'key', fetcher)
 expect(result.status).toBe(200)
 expect(await result.json()).toMatchObject({ partial: false, data: [{ wordCount: 67559 }] })
 expect(fetcher).toHaveBeenCalledOnce()
})
it('rejects arbitrary hosts, paths, credentials, queries and redirects before fetching another target', async () => {
 const fetcher = vi.fn()
 for (const url of ['http://www.pubu.com.tw/ebook/1', 'https://evil.test/ebook/1', 'https://www.pubu.com.tw.evil.test/ebook/1', 'https://user@www.pubu.com.tw/ebook/1', 'https://www.pubu.com.tw/search?kw=test', 'https://www.pubu.com.tw/ebook/1?next=x', 'https://www.pubu.com.tw/ebook/1#x']) {
  expect(pubuBookId(url)).toBeNull()
  expect(isMetadataSourceUrl(url)).toBe(false)
  expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?' + new URLSearchParams({ source: 'pubu', url })), undefined, fetcher)).status).toBe(400)
 }
 expect(fetcher).not.toHaveBeenCalled()
 fetcher.mockResolvedValue(new Response('', { status: 302, headers: { Location: 'https://evil.test' } }))
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=pubu&url=https://www.pubu.com.tw/ebook/1'), undefined, fetcher)).status).toBe(502)
 expect(fetcher).toHaveBeenCalledOnce()
})
it('allows only fixed Pubu image paths and bounds both page and cover responses', async () => {
 const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(1500001)))
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata?source=pubu&url=https://www.pubu.com.tw/ebook/697279'), undefined, fetcher)).status).toBe(502)
 fetcher.mockClear()
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?pubu=//evil.test/a.jpg'), undefined, fetcher)).status).toBe(400)
 expect(fetcher).not.toHaveBeenCalled()
 fetcher.mockImplementation(async url => {
  expect(String(url)).toBe('https://res2.pubu.tw/docs/595849/19949/cfkPx9_l.jpg')
  return new Response('jpeg', { headers: { 'Content-Type': 'image/jpeg' } })
 })
 expect((await handleBookMetadataSearch(new Request('https://app.test/api/v1/books/metadata/cover?pubu=/docs/595849/19949/cfkPx9_l.jpg'), undefined, fetcher)).status).toBe(200)
})

it('keeps translator separate from author and never converts page count to word count', () => {
 const candidate = parsePubuBook(readFileSync(new URL('../fixtures/book-metadata/pubu-359263.html', import.meta.url), 'utf8'), '359263')
 expect(candidate).toMatchObject({ authors: ['威廉．薩默塞特．毛姆'], translators: ['陳逸軒'], publisher: '麥田出版', isbn: '9786263104648' })
 expect(candidate).not.toHaveProperty('wordCount')
 expect(candidate).not.toHaveProperty('seriesName')
})
