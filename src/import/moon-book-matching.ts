import { sourceDayDate } from '../domain/source-reading-day'
import type { MoonBook } from './moon-backup-reader'
export interface MoonCatalog { deviceId: string; books: MoonBook[] }
export interface MoonBookCandidate {
  title: string
  author: string
  evidence: '完整路徑' | '同檔名' | '同書名' | '部分書名'
  sources: { deviceId: string; path: string }[]
}
const normalized = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s《》「」()（）[\]【】!！,，:：·・—─-]/g, '')
const basename = (path: string) => path.replace(/\\/g, '/').split('/').at(-1) ?? path
export function moonSourceTitle(path: string): string {
  const stem = basename(path).replace(/\.(txt|epub|pdf|mobi|azw3?)$/i, '').replace(/\.slim$/i, '')
  return /《([^》]+)》/.exec(stem)?.[1] ?? stem.replace(/^\d+[. ]+/, '').split(' - ')[0]
}
/** Suggestions only. Title and format similarity never changes source statistics or book identity. */
export function findMoonBookCandidates(path: string, deviceId: string, catalogs: MoonCatalog[]): MoonBookCandidate[] {
  const ranks = ['完整路徑', '同檔名', '同書名', '部分書名'] as const
  const sourceTitle = normalized(moonSourceTitle(path))
  const matches: { book: MoonBook; deviceId: string; rank: number }[] = []
  for (const catalog of catalogs) for (const book of catalog.books) {
    const title = normalized(moonSourceTitle(book.title))
    let rank = -1
    if (catalog.deviceId === deviceId && book.path === path) rank = 0
    else if (basename(book.path).normalize('NFKC').toLocaleLowerCase() === basename(path).normalize('NFKC').toLocaleLowerCase()) rank = 1
    else if (sourceTitle && sourceTitle === title) rank = 2
    else if (sourceTitle.length >= 4 && title.length >= 4 && (title.includes(sourceTitle) || sourceTitle.includes(title))) rank = 3
    if (rank >= 0) matches.push({ book, deviceId: catalog.deviceId, rank })
  }
  // An exact same-device source path is stronger than unrelated title suggestions.
  const selected = matches.some(match => match.rank === 0) ? matches.filter(match => match.rank === 0) : matches
  const grouped = new Map<string, MoonBookCandidate>()
  for (const match of selected) {
    // Preserve differing editions, authors and file formats as separate choices.
    const key = JSON.stringify([normalized(match.book.title), normalized(match.book.author), basename(match.book.path).normalize('NFKC').toLocaleLowerCase()])
    let candidate = grouped.get(key)
    if (!candidate) {
      candidate = { title: match.book.title, author: match.book.author, evidence: ranks[match.rank], sources: [] }
      grouped.set(key, candidate)
    } else if (match.rank < ranks.indexOf(candidate.evidence)) candidate.evidence = ranks[match.rank]
    if (!candidate.sources.some(source => source.deviceId === match.deviceId && source.path === match.book.path)) candidate.sources.push({ deviceId: match.deviceId, path: match.book.path })
  }
  return [...grouped.values()].sort((a, b) => ranks.indexOf(a.evidence) - ranks.indexOf(b.evidence))
}
/** Calendar-day conversion sampled against all three source devices; this is not a session timestamp. */
export function moonDayDate(dayCode: number): string {
  return sourceDayDate(dayCode)
}
