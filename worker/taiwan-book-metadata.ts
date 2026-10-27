import type { BookMetadataCandidate } from '../src/domain/book-metadata'
export class PublisherLookupError extends Error {
 readonly kind: 'http' | 'network' | 'format' | 'timeout' | 'maintenance'
 readonly httpStatus?: number
 constructor(kind: 'http' | 'network' | 'format' | 'timeout' | 'maintenance', status?: number) {
  super(kind === 'maintenance' ? '讀書共和國目前導向官方維護公告，暫時無法搜尋。' : kind === 'http' ? `出版社來源回應失敗（HTTP ${status}），可改用網頁搜尋。` : kind === 'timeout' ? '出版社來源回應逾時，可稍後重試。' : kind === 'network' ? '目前無法連線至出版社來源，可改用網頁搜尋。' : '出版社頁面格式無法辨識，可改用網頁搜尋。')
  this.kind = kind; this.httpStatus = status
 }
}
const decode = (value: string): string => value.replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_, hex, dec) => { const code = parseInt(hex ?? dec, hex ? 16 : 10); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '' }).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
export const htmlText = (value: string): string => decode(value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<[^>]*>/g, '')).trim()
const titleKey = (value: string) => value.normalize('NFKC').replace(/\s+/g, '').toLowerCase()
export function publisherSearchRows(html: string, query: string): { id: string; title: string }[] {
 const section = html.split(/id=["']re_list["']/)[1]
 if (!section) { if (/查無|沒有符合|沒有找到/.test(html)) return []; throw new PublisherLookupError('format') }
 const seen = new Set<string>(), rows: { id: string; title: string }[] = []
 for (const match of section.matchAll(/<h3[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
  const url = new URL(decode(match[1]), 'https://www.bookrep.com.tw/'), id = url.searchParams.get('id'), title = htmlText(match[2]).slice(0, 300)
  if (url.hostname !== 'www.bookrep.com.tw' || url.searchParams.get('at') !== 'bookcontent' || !id || !/^\d{1,10}$/.test(id) || seen.has(id) || !title || title.includes('套書') && !query.includes('套書')) continue
  seen.add(id); rows.push({ id, title })
 }
 const key = titleKey(query), rank = (title: string) => titleKey(title.split(/[：:]/)[0]) === key ? 0 : titleKey(title).includes(key) ? 1 : 2
 return rows.sort((a, b) => rank(a.title) - rank(b.title)).slice(0, 4)
}
export function parsePublisherBook(html: string, id: string): BookMetadataCandidate {
 if (!/^\d{1,10}$/.test(id)) throw new Error('出版社書目識別無效')
 const main = html.split(/class=["']article_pic_c["']/)[1]?.split(/class=["']article_pic_c_fx["']/)[0] ?? ''
 const title = htmlText(main.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '').slice(0, 300)
 const field = (name: string) => htmlText(main.match(new RegExp('<p[^>]*>\\s*' + name + '：[\\s\\S]*?<\\/p>', 'i'))?.[0] ?? '').replace(new RegExp('^' + name + '：'), '').trim()
 const authors = field('作者').split(/[、；;]/).map(name => name.trim()).filter(Boolean).slice(0, 10)
 const originalTitle = htmlText(main.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] ?? '').slice(0, 500)
 const names = (label: string) => field(label).split(/[、；;]/).map(name => name.trim()).filter(Boolean).slice(0, 20).map(name => name.slice(0, 200))
 const translators = names('譯者'), illustrators = [...new Set([...names('繪者'), ...names('插畫'), ...names('插畫者'), ...names('繪圖')])].slice(0, 20)
 const publisher = htmlText(main.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? '').replace(/^出版品牌：/, '').slice(0, 200)
 const isbn = field('ISBN').replace(/[\s-]/g, ''), publishedOn = field('出版日期').slice(0, 80)
 if (!title || !authors.length || !/^(?:\d{13}|\d{9}[\dXx])$/.test(isbn)) throw new PublisherLookupError('format')
 const gallery = html.split(/id=["']gallery["']/)[1]?.split('</ul>')[0] ?? ''
 const image = gallery.match(/<img\b[^>]*src=["']https:\/\/www\.bookrepclub\.com\.tw\/webroot\/file\/book\/(pic_\d+_\d+_[a-z0-9]+\.(?:jpg|png|webp))["']/i)?.[1]
 return { id: 'bookrep:' + id, source: '讀書共和國', title, authors, ...(originalTitle ? { originalTitle } : {}), ...(translators.length ? { translators } : {}), ...(illustrators.length ? { illustrators } : {}), publisher, isbn, publishedOn, sourceUrl: `https://www.bookrep.com.tw/?md=gwindex&cl=book&at=bookcontent&id=${id}`, coverUrl: image ? '/api/v1/books/metadata/cover?publisher=' + encodeURIComponent(image) : null }
}
export async function searchTaiwanPublisher(title: string, author: string, read: (url: URL | string) => Promise<string>): Promise<BookMetadataCandidate[]> {
 const query = title.replace(/(?<=[\p{Script=Han}\d])\s+(?=[\p{Script=Han}\d])/gu, '')
 const url = new URL('https://www.bookrep.com.tw/'); url.search = new URLSearchParams({ md: 'gwindex', cl: 'book', at: 'search', query }).toString()
 const rows = publisherSearchRows(await read(url), query), candidates: BookMetadataCandidate[] = []
 let failures = 0, failure: unknown
 // At most two concurrent detail requests, and four records per explicit search.
 for (let i = 0; i < rows.length; i += 2) {
  const results = await Promise.allSettled(rows.slice(i, i + 2).map(async row => parsePublisherBook(await read(`https://www.bookrep.com.tw/?md=gwindex&cl=book&at=bookcontent&id=${row.id}`), row.id)))
  for (const result of results) { if (result.status === 'fulfilled') candidates.push(result.value); else { failures++; failure ??= result.reason } }
 }
 if (failures && !candidates.length) throw failure instanceof PublisherLookupError ? failure : new PublisherLookupError('format')
 const match = (candidate: BookMetadataCandidate) => Boolean(author.trim() && candidate.authors.some(name => titleKey(name) === titleKey(author)))
 return candidates.sort((a, b) => Number(match(b)) - Number(match(a)))
}
