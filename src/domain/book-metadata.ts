export interface BookMetadataCandidate {
 id: string
 source: 'Open Library' | 'Google Books' | '讀書共和國' | 'Pubu' | '讀墨（貼上文字）' | '台灣角川'
 title: string
 authors: string[]
 publisher: string
 isbn: string
 publishedOn: string
 sourceUrl: string
 coverUrl: string | null
 bookForm?: 'novel' | 'manga'
 originalTitle?: string
 authorOriginalNames?: string[]
 translators?: string[]
 illustrators?: string[]
 wordCount?: number
 seriesName?: string
 sequenceLabel?: string
}

export function isMetadataSourceUrl(value: string): boolean {
 try {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false
  if (url.hostname === 'www.kadokawa.com.tw') return /^\/products\/\d{13}$/.test(url.pathname) && !url.search && !url.hash
  if (url.hostname === 'readmoo.com') return /^\/book\/\d{15}$/.test(url.pathname) && !url.search && !url.hash
  if (url.hostname === 'www.pubu.com.tw') return /^\/ebook\/\d{1,10}$/.test(url.pathname) && !url.search && !url.hash
  if (url.hostname === 'openlibrary.org') return /^\/books\/OL\d+M$/.test(url.pathname) && !url.search
  if (url.hostname === 'books.google.com') return url.pathname === '/books' && /^[A-Za-z0-9_-]+$/.test(url.searchParams.get('id') ?? '') && [...url.searchParams.keys()].every(key => key === 'id')
  return url.hostname === 'www.bookrep.com.tw' && url.pathname === '/' && url.searchParams.get('md') === 'gwindex' && url.searchParams.get('cl') === 'book' && url.searchParams.get('at') === 'bookcontent' && /^\d{1,10}$/.test(url.searchParams.get('id') ?? '') && [...url.searchParams.keys()].every(key => ['md', 'cl', 'at', 'id'].includes(key))
 } catch { return false }
}

export const METADATA_FIELD_LABELS = {
 bookForm: '作品形式', title: '書名', authors: '作者', publisher: '出版社', isbn: 'ISBN', publishedOn: '出版日期',
 originalTitle: '原文書名', authorOriginalNames: '作者原名', translators: '譯者', illustrators: '繪者／插畫者', wordCount: '字數', seriesName: '系列名稱', sequenceLabel: '卷次／集數'
} as const
export type BookMetadataField = keyof typeof METADATA_FIELD_LABELS
export const metadataFields = Object.keys(METADATA_FIELD_LABELS) as BookMetadataField[]
export function metadataFieldValue(candidate: BookMetadataCandidate, field: BookMetadataField): string {
 if (field === 'bookForm') return candidate.bookForm === 'novel' ? '小說' : candidate.bookForm === 'manga' ? '漫畫' : ''
 const value = candidate[field]
 return Array.isArray(value) ? value.join('、') : value === undefined ? '' : String(value)
}
export function defaultMetadataFields(candidate: BookMetadataCandidate): BookMetadataField[] {
 return metadataFields.filter(field => field !== 'seriesName' && field !== 'sequenceLabel' && !(['Pubu', '讀墨（貼上文字）', '台灣角川'].includes(candidate.source) && (field === 'isbn' || field === 'publishedOn')) && Boolean(metadataFieldValue(candidate, field)))
}
export function isBookMetadataCandidate(value: unknown): value is BookMetadataCandidate {
 if (!value || typeof value !== 'object') return false
 const row = value as Record<string, unknown>
 const text = (v: unknown, limit: number) => typeof v === 'string' && v.length <= limit
 const names = (v: unknown) => Array.isArray(v) && v.length <= 20 && v.every(name => text(name, 200) && String(name).trim())
 return text(row.id, 200) && Boolean(row.id) && ['Open Library', 'Google Books', '讀書共和國', 'Pubu', '讀墨（貼上文字）', '台灣角川'].includes(String(row.source))
  && text(row.title, 300) && Boolean(String(row.title).trim()) && names(row.authors) && text(row.publisher, 200)
  && text(row.isbn, 40) && text(row.publishedOn, 80) && typeof row.sourceUrl === 'string' && isMetadataSourceUrl(row.sourceUrl)
  && (row.coverUrl === null || text(row.coverUrl, 2000))
  && ['authorOriginalNames', 'translators', 'illustrators'].every(key => row[key] === undefined || names(row[key]))
  && ['originalTitle', 'seriesName', 'sequenceLabel'].every(key => row[key] === undefined || text(row[key], key === 'originalTitle' ? 500 : key === 'seriesName' ? 200 : 100))
  && (row.bookForm === undefined || row.bookForm === 'novel' || row.bookForm === 'manga')
  && (row.wordCount === undefined || Number.isSafeInteger(row.wordCount) && Number(row.wordCount) > 0)
}
