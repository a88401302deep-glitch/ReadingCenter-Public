import type { BookMetadataCandidate } from '../src/domain/book-metadata'
import { htmlText } from './taiwan-book-metadata'

/** Only canonical public book URLs; never follow caller-supplied hosts or redirects. */
export function pubuBookId(value: string): string | null {
 try {
  const url = new URL(value)
  return url.protocol === 'https:' && url.hostname === 'www.pubu.com.tw' && !url.port && !url.username && !url.password && !url.search && !url.hash
   ? url.pathname.match(/^\/ebook\/(\d{1,10})\/?$/)?.[1] ?? null : null
 } catch { return null }
}
export const pubuCoverPath = /^\/docs\/\d{1,10}\/\d{1,10}\/[A-Za-z0-9_-]{1,100}_l\.(?:jpg|png|webp)$/

export function parsePubuBook(html: string, id: string): BookMetadataCandidate {
 if (!/^\d{1,10}$/.test(id)) throw new Error('Pubu 書目識別無效')
 let book: Record<string, unknown> | undefined
 for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  try {
   const value: unknown = JSON.parse(match[1])
   if (value && typeof value === 'object' && !Array.isArray(value) && '@type' in value && value['@type'] === 'Book') { book = value as Record<string, unknown>; break }
  } catch { /* An unrelated malformed script must not become metadata. */ }
 }
 const text = (value: unknown, max: number) => typeof value === 'string' ? htmlText(value).slice(0, max) : ''
 const title = text(book?.name, 300)
 if (!book || !title || pubuBookId(String(book.url)) !== id) throw new Error('Pubu 書頁格式無法辨識，可手動輸入')
 const names = (value: unknown): string[] => (Array.isArray(value) ? value : [value]).flatMap(item => {
  const name = text(typeof item === 'object' && item !== null && 'name' in item ? item.name : item, 200)
  return name ? [name] : []
 }).slice(0, 20)
 const credits = html.split(/class=["']info-name-metaAuthor["']/)[1]?.split(/class=["']info-btngroup["']/)[0] ?? ''
 const translators = [...new Set([...credits.matchAll(/<a\b[^>]*href=["']\/search\?condition=fl_trans%3D[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)].map(match => htmlText(match[1]).slice(0, 200)).filter(Boolean))].slice(0, 20)
 // Read only the product information table, never prose, recommendations or author biographies.
 const table = html.match(/<div\b[^>]*class=["']list-info-table\b[^"']*["'][^>]*>([\s\S]*?)(?=<div\b[^>]*class=["']list-info-table\b)/i)?.[1] ?? ''
 const field = (label: string) => htmlText(table.match(new RegExp('<div[^>]*class=["\']col-4["\'][^>]*>\\s*<(?:span|sapn)>\\s*' + label + '\\s*<\\/(?:span|sapn)>\\s*<\\/div>\\s*<div[^>]*class=["\']col-8["\'][^>]*>([\\s\\S]*?)<\\/div>', 'i'))?.[1] ?? '')
 // JSON-LD ISBN can describe the paper edition. Only the visible ebook product field is eligible.
 const rawIsbn = field('(?:eISBN|ISBN)').replace(/[\s-]/g, '')
 const isbn = /^(?:\d{13}|\d{9}[\dXx])$/.test(rawIsbn) ? rawIsbn : ''
 const date = field('(?:Released|出版日期)'), publishedOn = /^\d{4}\/\d{2}\/\d{2}$/.test(date) ? date.replaceAll('/', '-') : ''
 const rawCount = field('字數'), wordCount = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(rawCount) ? Number(rawCount.replaceAll(',', '')) : 0
 const seriesName = htmlText(html.match(/<span\b[^>]*>\s*(?:Series|系列叢書)\s*<\/span>\s*<a\b[^>]*href=["']https:\/\/www\.pubu\.com\.tw\/store\/\d+\/series\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? '').slice(0, 200)
 let coverUrl: string | null = null
 try {
  const image = new URL(String(book.image))
  if (image.protocol === 'https:' && image.hostname === 'res2.pubu.tw' && !image.username && !image.password && !image.port && !image.search && !image.hash && pubuCoverPath.test(image.pathname)) coverUrl = '/api/v1/books/metadata/cover?pubu=' + encodeURIComponent(image.pathname)
 } catch { /* A cover is optional. */ }
 return { id: 'pubu:' + id, source: 'Pubu', title, authors: names(book.author), publisher: names(book.publisher)[0] ?? '', isbn, publishedOn, sourceUrl: 'https://www.pubu.com.tw/ebook/' + id, coverUrl,
  ...(translators.length ? { translators } : {}), ...(Number.isSafeInteger(wordCount) && wordCount > 0 ? { wordCount } : {}), ...(seriesName ? { seriesName } : {}) }
}
