import { isMetadataSourceUrl } from '../../domain/book-metadata'
import { createMetadata, type Book, type DictionaryEntry } from '../../domain'
import type { ReadingCenterRepositories } from '../../data'
export interface BookMetadataDraft { authorNames?: string[]; translatorNames?: string[]; illustratorNames?: string[]; publisherName?: string; isbn?: string; publishedOn?: string; metadataSourceUrl?: string }
export async function planBookMetadata(repositories: ReadingCenterRepositories, book: Book | undefined, draft: BookMetadataDraft, now: string) {
 const isbn = draft.isbn === undefined ? book?.isbn ?? null : draft.isbn.replace(/[\s-]/g, '') || null
 if (draft.isbn !== undefined && isbn && !/^(?:\d{13}|\d{9}[\dXx])$/.test(isbn)) throw new Error('ISBN 應為 10 或 13 碼；不確定請留白')
 for (const names of [draft.translatorNames, draft.illustratorNames]) if (names && (names.length > 20 || names.some(name => !name.trim() || name.length > 200))) throw new Error('譯者或繪者資料無效')
 if (draft.authorNames && (draft.authorNames.length > 100 || draft.authorNames.some(name => !name.trim() || name.length > 200))) throw new Error('作者資料無效')
 if ((draft.publisherName?.length ?? 0) > 200 || (draft.publishedOn?.length ?? 0) > 80) throw new Error('出版資料過長')
 if (draft.metadataSourceUrl && !isMetadataSourceUrl(draft.metadataSourceUrl)) throw new Error('書籍資料來源無效')
 const dictionaries = draft.authorNames !== undefined || draft.publisherName !== undefined || draft.translatorNames !== undefined || draft.illustratorNames !== undefined ? await repositories.dictionaries.getAll() : []
 const additions: DictionaryEntry[] = [], key = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase()
 const lookup = (kind: 'author' | 'publisher', name: string): string => {
  const found = [...dictionaries, ...additions].find(entry => entry.kind === kind && (key(entry.name) === key(name) || entry.kind === 'author' && entry.aliases.some(alias => key(alias) === key(name))))
  if (found) return found.id
  const base = { ...createMetadata({ id: crypto.randomUUID(), now }), name: name.trim(), color: null }
  const entry: DictionaryEntry = kind === 'author' ? { ...base, kind, aliases: [] } : { ...base, kind }
  additions.push(entry); return entry.id
 }
 const authorIds = draft.authorNames === undefined ? book?.authorIds ?? [] : [...new Set(draft.authorNames.map(name => lookup('author', name)))]
 const publisherId = draft.publisherName === undefined ? book?.publisherId ?? null : draft.publisherName.trim() ? lookup('publisher', draft.publisherName) : null
 const credits = [...(book?.creatorCredits ?? (book?.authorIds ?? []).map(creatorId => ({ creatorId, role: 'author' as const })))]
 const replaceCredits = (role: 'author' | 'translator' | 'illustration', ids: string[]) => {
  for (let i = credits.length - 1; i >= 0; i--) if (credits[i].role === role) credits.splice(i, 1)
  credits.push(...[...new Set(ids)].map(creatorId => ({ creatorId, role })))
 }
 if (draft.authorNames !== undefined) replaceCredits('author', authorIds)
 if (draft.translatorNames !== undefined) replaceCredits('translator', draft.translatorNames.map(name => lookup('author', name)))
 if (draft.illustratorNames !== undefined) replaceCredits('illustration', draft.illustratorNames.map(name => lookup('author', name)))
 const creditsChanged = draft.authorNames !== undefined || draft.translatorNames !== undefined || draft.illustratorNames !== undefined
 return { additions, fields: { authorIds, publisherId, isbn, publishedOn: draft.publishedOn === undefined ? book?.publishedOn ?? null : draft.publishedOn.trim() || null,
  ...(creditsChanged ? { creatorCredits: credits } : {}) } }

}
