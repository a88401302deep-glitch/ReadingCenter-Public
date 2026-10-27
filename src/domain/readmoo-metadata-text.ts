import { isBookMetadataCandidate, type BookMetadataCandidate } from './book-metadata'

const labels = ['書名', '作者', '原文作者', '作者原名', '譯者', '插畫', '繪者', '插畫者', '出版社', '出版日期', 'eISBN', 'ISBN', '字數', '原文書名', '系列名稱', '系列', '卷次', '集數', '語言', '檔案大小', '商品格式', '頁數', '原文語言']
const token = new RegExp('(?:^|\\s)(' + labels.join('|') + ')\\s*[:：]', 'gim')

/** User-pasted public product facts only. No network, clipboard access or persistence. */
export function parseReadmooMetadataText(raw: string, sourceUrl: string, confirmedTitle: string): { candidate: BookMetadataCandidate; warnings: string[] } {
 const title = confirmedTitle.trim()
 if (!title || title.length > 300) throw new Error('請確認這段資料所屬的書名')
 if (!raw.trim() || raw.length > 20000) throw new Error('請貼上 20,000 字以內的書籍資料區文字')
 let url: URL
 try { url = new URL(sourceUrl.trim()) } catch { throw new Error('請貼上讀墨單本書頁網址') }
 const id = url.pathname.match(/^\/book\/(\d{15})\/?$/)?.[1]
 if (!id || url.protocol !== 'https:' || !['readmoo.com', 'console.readmoo.com'].includes(url.hostname) || url.username || url.password || url.port || url.search || url.hash) throw new Error('請貼上 https://readmoo.com/book/書目編號 的單本書頁網址')
 if (/<\/?[a-z][^>]*>/i.test(raw)) throw new Error('請貼上書頁顯示的文字，不是 HTML 原始碼')
 const facts = raw.replace(/\r/g, '').split(/\n\s*(?:詳細資訊|作者介紹|作者簡介|目錄列表|內容簡介)\s*(?:\n|$)/)[0]
 const matches = [...facts.matchAll(token)], values = new Map<string, string[]>(), warnings: string[] = []
 for (let index = 0; index < matches.length; index++) {
  const match = matches[index], start = (match.index ?? 0) + match[0].length
  // One value line, optionally on the next line; never sweep up a biography or navigation.
  const value = facts.slice(start, matches[index + 1]?.index ?? facts.length).trim().split('\n')[0].trim().replace(/\s*(?:關注|追蹤)\s*$/, '').trim()
  if (value) { const key = match[1].toLowerCase(); values.set(key, [...(values.get(key) ?? []), value]) }
 }
 const field = (keys: string[], limit: number): string => {
  const found = [...new Set(keys.flatMap(key => values.get(key.toLowerCase()) ?? []))]
  if (found.length > 1) { warnings.push(keys[0] + '有多個不同值，請手動核對'); return '' }
  if ((found[0]?.length ?? 0) > limit) { warnings.push(keys[0] + '文字過長，請手動核對'); return '' }
  return found[0] ?? ''
 }
 const names = (keys: string[]) => {
  const value = field(keys, 4000), result = value.split(/[、;；]/).map(name => name.trim()).filter(Boolean)
  if (result.length > 20 || result.some(name => name.length > 200)) { warnings.push(keys[0] + '名單過長，請手動核對'); return [] }
  return result
 }
 const pastedTitle = field(['書名'], 300)
 if (pastedTitle && pastedTitle !== title) throw new Error('貼上文字中的書名與核對書名不同，請先確認書籍與版本')
 const authors = names(['作者']), translators = names(['譯者']), illustrators = names(['插畫', '繪者', '插畫者']), authorOriginalNames = names(['原文作者', '作者原名'])
 const originalTitle = field(['原文書名'], 500), publisher = field(['出版社'], 200), seriesName = field(['系列名稱', '系列'], 200), sequenceLabel = field(['卷次', '集數'], 100)
 // Readmoo displays both paper ISBN and eISBN: only the explicit eISBN is eligible.
 const rawIsbn = field(['eISBN'], 40).replace(/[\s-]/g, ''), isbn = /^(?:\d{13}|\d{9}[\dXx])$/.test(rawIsbn) ? rawIsbn : ''
 const date = field(['出版日期'], 80), publishedOn = /^\d{4}[/-]\d{2}[/-]\d{2}$/.test(date) ? date.replaceAll('/', '-') : ''
 const count = field(['字數'], 40).replace(/\s*字$/, ''), wordCount = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(count) ? Number(count.replaceAll(',', '')) : 0
 if (rawIsbn && !isbn) warnings.push('eISBN 格式無法辨識，請手動核對')
 if (date && !publishedOn) warnings.push('出版日期格式無法辨識，請手動核對')
 if (count && (!Number.isSafeInteger(wordCount) || wordCount <= 0)) warnings.push('字數格式無法辨識，請手動核對')
 const candidate: BookMetadataCandidate = { id: 'readmoo-text:' + id, source: '讀墨（貼上文字）', title, authors, publisher, isbn, publishedOn, sourceUrl: 'https://readmoo.com/book/' + id, coverUrl: null,
  ...(translators.length ? { translators } : {}), ...(illustrators.length ? { illustrators } : {}), ...(authorOriginalNames.length ? { authorOriginalNames } : {}), ...(originalTitle ? { originalTitle } : {}),
  ...(seriesName ? { seriesName } : {}), ...(sequenceLabel ? { sequenceLabel } : {}), ...(Number.isSafeInteger(wordCount) && wordCount > 0 ? { wordCount } : {}) }
 if (!isBookMetadataCandidate(candidate)) throw new Error('書籍資料格式無法辨識，請手動核對')
 if (!authors.length && !publisher && !isbn && !publishedOn && !translators.length && !illustrators.length && !authorOriginalNames.length && !originalTitle && !seriesName && !sequenceLabel && !candidate.wordCount) throw new Error('未找到可確認的欄位，請貼上含「作者：」「字數：」等標籤的書籍資料區')
 return { candidate, warnings }
}
