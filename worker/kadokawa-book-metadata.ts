import type { BookMetadataCandidate } from '../src/domain/book-metadata'
import { htmlText, PublisherLookupError } from './taiwan-book-metadata'

export const kadokawaCoverPath = /^\/media\/image_clips\/[a-f0-9]{24}\/original\.(?:jpg|png|webp)$/
const key = (value: string) => value.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
const textLines = (html: string) => htmlText(html.replace(/<(?:br\b[^>]*|\/(?:p|div|h[1-6]))>/gi, '\n')).split('\n').map(line => line.trim()).filter(Boolean)

export function kadokawaSearchRows(html: string, query: string): { id: string; title: string }[] {
 const rows: { id: string; title: string }[] = [], seen = new Set<string>()
 for (const match of html.matchAll(/<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi)) {
  if (!/\bjs-quick-cart-item\b/.test(match[1])) continue
  const title = htmlText(match[3].match(/<div\b[^>]*class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? '')
  let url: URL
  try { url = new URL(match[2].replace(/&amp;/g, '&'), 'https://www.kadokawa.com.tw') } catch { continue }
  const id = url.pathname.match(/^\/products\/(\d{13})$/)?.[1]
  if (url.origin !== 'https://www.kadokawa.com.tw' || url.username || url.password || url.search || url.hash || !id || seen.has(id) || !title || title.length > 300 || !key(title).includes(key(query))) continue
  seen.add(id); rows.push({ id, title })
 }
 if (!/ProductList|js-quick-cart-item/.test(html) && !/沒有符合|找不到|無符合|沒有商品/.test(html)) throw new PublisherLookupError('format')
 return rows.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant', { numeric: true })).slice(0, 4)
}

export function parseKadokawaBook(html: string, id: string): BookMetadataCandidate {
 if (!/^\d{13}$/.test(id)) throw new Error('角川書頁識別無效')
 const sourceUrl = 'https://www.kadokawa.com.tw/products/' + id
 const canonical = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
 if (canonical !== sourceUrl) throw new PublisherLookupError('format')
 const breadcrumb = html.match(/<!-- Breadcrumb -->([\s\S]*?)<!-- END Breadcrumb -->/)?.[1] ?? ''
 const categories = [...breadcrumb.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map(match => htmlText(match[1]))
 const bookForm = categories.includes('漫畫') ? 'manga' : categories.includes('輕小說') || categories.includes('小說') ? 'novel' : undefined
 // Generic book breadcrumbs are valid too; they do not establish novel/manga.
 // Keep the explicit book-category gate so merchandise remains excluded.
 if (!bookForm && !categories.includes('書籍')) throw new PublisherLookupError('format')
 const rich = html.match(/<!-- START SHOPLINE RICH CONTENT -->([\s\S]*?)<!-- END SHOPLINE RICH CONTENT -->/)?.[1] ?? ''
 const summary = [...html.matchAll(/<p\b[^>]*class=["'][^"']*Product-summary[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)].map(match => match[1]).join('\n')
 const lines = textLines(summary + '\n' + rich)
 const introduction = lines.slice(Math.max(0, lines.findIndex(line => line === '【作者介紹】')))
 const names = (label: string) => introduction.flatMap(line => {
  const match = line.match(new RegExp('^' + label + '[：:]\\s*(.+)$'))
  return match ? [match[1].trim()] : []
 }).filter(name => name.length > 0 && name.length <= 200 && !/[。！？]/.test(name)).slice(0, 20)
 // A short author summary is a fallback only; role-prefixed people are not merged.
 const authors = bookForm === 'manga' ? names('漫畫') : names('作者')
 if (!authors.length) {
  const summaryName = lines.find(line => line.startsWith('作者資訊：'))?.slice(5).split('/')[0].trim()
  if (summaryName && summaryName.length <= 200 && !/[：:。！？]/.test(summaryName)) authors.push(summaryName)
 }
 const illustrators = [...new Set([...names('插畫'), ...names('繪者')])]
 let product: Record<string, unknown> | undefined
 for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
  try {
   const data: unknown = JSON.parse(match[1])
   if (data && typeof data === 'object' && !Array.isArray(data) && (data as Record<string, unknown>)['@type'] === 'Product') { product = data as Record<string, unknown>; break }
  } catch { /* Ignore unrelated malformed structured data. */ }
 }
 const title = typeof product?.name === 'string' ? product.name.trim() : ''
 if (!title || title.length > 300 || !authors.length) throw new PublisherLookupError('format')
 const isbn = lines.find(line => /^ISBN[：:]\s*[\d -]+$/.test(line))?.replace(/^ISBN[：:]\s*/, '').replace(/[\s-]/g, '') ?? ''
 // 上市日期 is not silently relabelled as 出版日期; a product URL is not ISBN evidence.
 const publishedOn = lines.find(line => /^出版日期[：:]/.test(line))?.replace(/^出版日期[：:]\s*/, '').slice(0, 80) ?? ''
 let coverUrl: string | null = null
 const image = Array.isArray(product?.image) ? product.image[0] : product?.image
 if (typeof image === 'string') {
  try {
   const url = new URL(image)
   if (url.protocol === 'https:' && url.hostname === 'img.shoplineapp.com' && !url.username && !url.password && !url.port && kadokawaCoverPath.test(url.pathname)) coverUrl = '/api/v1/books/metadata/cover?kadokawa=' + encodeURIComponent(url.pathname)
  } catch { /* Cover is optional. */ }
 }
 const volume = title.match(/[（(]\s*(\d+)\s*[)）]/)?.[1]
 return { id: 'kadokawa:' + id, source: '台灣角川', title, authors, publisher: '台灣角川', ...(bookForm ? { bookForm } : {}), isbn: /^\d{13}$/.test(isbn) ? isbn : '', publishedOn, sourceUrl, coverUrl,
  ...(illustrators.length ? { illustrators } : {}), ...(volume ? { sequenceLabel: '第 ' + volume + ' 集' } : {}) }
}

export async function searchKadokawa(title: string, author: string, read: (url: URL | string) => Promise<string>): Promise<BookMetadataCandidate[]> {
 const url = new URL('https://www.kadokawa.com.tw/products')
 url.search = new URLSearchParams({ query: title }).toString()
 const rows = kadokawaSearchRows(await read(url), title), candidates: BookMetadataCandidate[] = []
 let failures = 0
 for (let i = 0; i < rows.length; i += 2) {
  const results = await Promise.allSettled(rows.slice(i, i + 2).map(async row => parseKadokawaBook(await read('https://www.kadokawa.com.tw/products/' + row.id), row.id)))
  for (const result of results) { if (result.status === 'fulfilled') candidates.push(result.value); else failures++ }
 }
 if (rows.length && failures === rows.length) throw new PublisherLookupError('format')
 return candidates.sort((a, b) => Number(Boolean(author && b.authors.some(name => key(name) === key(author)))) - Number(Boolean(author && a.authors.some(name => key(name) === key(author)))))
}
