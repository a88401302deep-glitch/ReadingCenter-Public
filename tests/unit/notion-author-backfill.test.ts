import { assertValidBook, assertValidWork, migrateBookToWork, type CreatorCredit } from '../../src/domain'
import { expect, it, vi } from 'vitest'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data'
import { getNotionAuthorTexts, parseNotionAuthorCredits, parseNotionAuthorNames, prepareNotionAuthorBackfill, runNotionAuthorBackfill } from '../../src/import/notion-author-backfill'
import { RemoteApiError } from '../../src/sync/cloudflare/entity-client'
import type { StoredRemoteEntity } from '../../src/server/entity-api'
import { NOTION_AUTHOR_URL_EVIDENCE, resolveNotionAuthorSource, resolveNotionAuthorUrl } from '../../src/import/notion-author-url-evidence'

async function fixture(author = '甲作者|乙作者') {
  const book = await new BookService(createInMemoryRepositories(), () => 'book', () => '2026-10-02T00:00:00.000Z').create({ title: '測試書籍', mediaTypeId: 'ebook' })
  book.provenance = { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: `${'a'.repeat(64)}:2`, importedAt: book.createdAt }
  book.importSourceNotes = `Notion 歷史搬遷｜原始資料保留\n【來源第 2 列】\n作者：${author}\n來源：測試\n出版社：測試`
  const stored: StoredRemoteEntity = { schemaVersion: book.schemaVersion, provenance: book.provenance, kind: 'book', id: book.id, revision: 1, createdAt: book.createdAt, updatedAt: book.updatedAt, deletedAt: null, payload: book as unknown as NonNullable<StoredRemoteEntity['payload']> }
  return { book, stored }
}
it('splits literal author names but defers URLs, roles and bilingual aliases', () => {
  expect(parseNotionAuthorNames('甲作者,乙作者,甲作者')).toEqual(['甲作者', '乙作者'])
  expect(parseNotionAuthorNames('甲作者|乙作者 |')).toEqual(['甲作者', '乙作者'])
  for (const text of ['原作：甲作者 漫畫：乙作者', '作者|https://example.test/author', '中文名字|English Name', '', '甲\n乙']) expect(parseNotionAuthorNames(text)).toBeNull()
})
it('resolves only exact verified author URLs and defers publishers, combinations and lookalikes', async () => {
  expect(resolveNotionAuthorUrl(' https://readmoo.com/contributor/34403 ')).toBe('護玄')
  expect(resolveNotionAuthorUrl('toString')).toBeNull()
  for (const text of ['https://readmoo.com/publisher/189', 'https://readmoo.com/contributor/99999999', 'https://readmoo.com/contributor/34403https://readmoo.com/contributor/57492', 'https://readmoo.com.evil.test/contributor/34403', 'https://readmoo.com/contributor/34403?contributor_id=123', '繪者：https://readmoo.com/contributor/34403']) expect(resolveNotionAuthorUrl(text)).toBeNull()
  const { stored } = await fixture('https://readmoo.com/contributor/34403')
  expect(prepareNotionAuthorBackfill([stored]).candidates[0].names).toEqual(['護玄'])
  expect(prepareNotionAuthorBackfill([(await fixture('https://readmoo.com/publisher/189')).stored]).candidates).toEqual([])
})
it('reads legacy source evidence only and preserves existing or edited authors', async () => {
  const { book, stored } = await fixture()
  expect(getNotionAuthorTexts({ ...book, bookNote: book.importSourceNotes!, importSourceNotes: undefined })).toEqual(['甲作者|乙作者'])
  expect(getNotionAuthorTexts({ ...book, provenance: { kind: 'manual' } })).toEqual([])
  expect(getNotionAuthorTexts({ ...book, importSourceNotes: book.importSourceNotes!.replace('甲作者|乙作者', '甲作者\n乙作者') })).toEqual(['甲作者\n乙作者'])
  expect(prepareNotionAuthorBackfill([stored]).candidates[0].names).toEqual(['甲作者', '乙作者'])
  expect(prepareNotionAuthorBackfill([{ ...stored, revision: 2 }])).toMatchObject({ candidates: [], preserved: 1 })
  expect(prepareNotionAuthorBackfill([{ ...stored, payload: { ...book, authorIds: ['manual'] } as unknown as NonNullable<StoredRemoteEntity['payload']> }])).toMatchObject({ candidates: [], preserved: 1 })
})
it('creates dictionaries before linking them and preserves every other book field', async () => {
  const { book, stored } = await fixture()
  const apply = vi.fn().mockImplementation(async (entry) => ({ ...stored, kind: entry.kind, id: entry.entityId, payload: entry.entity, revision: entry.entity.revision }))
  const client = { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(stored), apply }
  const report = await runNotionAuthorBackfill(prepareNotionAuthorBackfill([stored]), client, new AbortController().signal, () => {})
  expect(report).toMatchObject({ added: 1, stopped: false })
  expect(apply.mock.calls.map(([entry]) => entry.kind)).toEqual(['dictionary', 'dictionary', 'book'])
  const written = apply.mock.calls[2][0].entity
  expect(written.authorIds).toHaveLength(2)
  expect({ ...written, authorIds: [], revision: book.revision, updatedAt: book.updatedAt }).toEqual(book)
  expect(prepareNotionAuthorBackfill([{ ...stored, payload: written, revision: 2 }]).candidates).toEqual([])
})
it('does not write if the book changed after preview', async () => {
  const { stored } = await fixture()
  const apply = vi.fn()
  const client = { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue({ ...stored, revision: 2 }), apply }
  expect(await runNotionAuthorBackfill(prepareNotionAuthorBackfill([stored]), client, new AbortController().signal, () => {})).toMatchObject({ added: 0, skipped: 1 })
  expect(apply).not.toHaveBeenCalled()
})
it('stops on lost authentication and leaves the book unmodified', async () => {
  const { stored } = await fixture()
  const apply = vi.fn().mockRejectedValue(new RemoteApiError(401, 'unauthorized', '請登入'))
  const client = { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(stored), apply }
  expect(await runNotionAuthorBackfill(prepareNotionAuthorBackfill([stored]), client, new AbortController().signal, () => {})).toMatchObject({ added: 0, stopped: true })
  expect(apply).toHaveBeenCalledTimes(1)
})

it('resolves verified publisher and author profiles including source list markers without broad URL decoding', async () => {
  const known = [
    ['• \u00a0https://readmoo.com/contributor/109699', '馥閒庭'],
    ['• https://readmoo.com/contributor/71226', '維特多．沙博爾夫斯基'],
    ['http://www.jjwxc.net/oneauthor.php?authorid=4599954', '修喵啊修喵'],
    ['http://www.jjwxc.net/oneauthor.php?authorid=1697012', '拉棉花糖的兔子'],
    ['https://search.books.com.tw/search/query/key/%E7%B4%BA%E5%90%89/adv_author/1/', '紺吉'],
    ['https://search.books.com.tw/search/query/key/%E3%81%A4%E3%81%8F%E3%81%BF%E3%81%9A/adv_author/1/', 'つくみず'],
    ['https://zh.wikipedia.org/zh-tw/%E6%A3%AE%E5%8D%9A%E5%97%A3', '森博嗣'],
    ['https://bookof.moe/s/AUT,%E5%B9%B8%E6%9D%91%E8%AA%A0/', '幸村誠'],
    ['https://readmoo.com/contributor/87099', '趣哥'],
    ['https://readmoo.com/contributor/20070', '月翔'],
    ['https://readmoo.com/contributor/24759', '陳名珉'],
    ['https://readmoo.com/contributor/59656', '李純瑀']
  ]
  for (const [raw, name] of known) {
    expect(resolveNotionAuthorUrl(raw)).toBe(name)
    expect(prepareNotionAuthorBackfill([(await fixture(raw)).stored]).candidates[0].names).toEqual([name])
  }
  for (const raw of [
    '•https://readmoo.com/contributor/34403',
    '• 繪者：https://readmoo.com/contributor/34403',
    'http://www.jjwxc.net/oneauthor.php?authorid=4599954&extra=1',
    'https://search.books.com.tw/search/query/key/Unknown/adv_author/1/',
    'https://zh.wikipedia.org/zh-tw/Other',
    'https://bookof.moe/s/AUT,Other/'
  ]) expect(resolveNotionAuthorUrl(raw)).toBeNull()
})

it('reports multiline author URLs as unresolved links rather than missing source authors', async () => {
  const raw = 'https://example.test/one\n, https://example.test/two'
  const { stored } = await fixture(raw)
  expect(prepareNotionAuthorBackfill([stored])).toMatchObject({ candidates: [], unresolved: [{ reason: '作者網址需要來源查證' }] })
})

it('parses explicit source roles, preserving supervision and rejecting ambiguous leftovers', () => {
  expect(parseNotionAuthorCredits('畫:はやせ淳|監修:櫻井寬')).toEqual([{ name: 'はやせ淳', role: 'illustration' }, { name: '櫻井寬', role: 'supervision' }])
  expect(parseNotionAuthorCredits('原作：西尾維新  漫畫：浅見よう')).toEqual([{ name: '西尾維新', role: 'original' }, { name: '浅見よう', role: 'manga' }])
  expect(parseNotionAuthorCredits('口述：唐鳳|採訪撰文：楊倩蓉')).toEqual([{ name: '唐鳳', role: 'oral' }, { name: '楊倩蓉', role: 'interviewWriting' }])
  for (const raw of ['作者', '監修：甲', '原作：甲|不明：乙', '原作：甲|', '漫畫：', '原作：甲 漫畫：乙', '漫畫：https://example.test/', '漫畫：甲\n監修：乙']) expect(parseNotionAuthorCredits(raw)).toBeNull()
})
it('writes both role dictionaries and credits but does not treat supervision as an author', async () => {
  const { book, stored } = await fixture('畫:はやせ淳|監修:櫻井寬')
  const apply = vi.fn().mockImplementation(async (entry) => ({ ...stored, kind: entry.kind, id: entry.entityId, payload: entry.entity, revision: entry.entity.revision }))
  await runNotionAuthorBackfill(prepareNotionAuthorBackfill([stored]), { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(stored), apply }, new AbortController().signal, () => {})
  const written = apply.mock.calls[2][0].entity
  expect(written.authorIds).toEqual([apply.mock.calls[0][0].entityId])
  expect(written.creatorCredits).toEqual([{ creatorId: apply.mock.calls[0][0].entityId, role: 'illustration' }, { creatorId: apply.mock.calls[1][0].entityId, role: 'supervision' }])
  expect({ ...written, authorIds: [], creatorCredits: undefined, revision: book.revision, updatedAt: book.updatedAt }).toEqual({ ...book, creatorCredits: undefined })
  const work = migrateBookToWork(written)
  expect(work.creatorCredits).toEqual(written.creatorCredits)
  expect(work.creatorCredits).not.toBe(written.creatorCredits)
  expect(() => assertValidWork(work)).not.toThrow()
})
it('creates one author with a verified bilingual alias and defers an unverified pair', async () => {
  const { stored } = await fixture('艾芙琳．博洛克―達諾|Évelyne Bloch-Dano')
  const plan = prepareNotionAuthorBackfill([stored])
  expect(plan.candidates[0].names).toEqual(['艾芙琳．博洛克―達諾'])
  const apply = vi.fn().mockImplementation(async (entry) => ({ ...stored, kind: entry.kind, id: entry.entityId, payload: entry.entity, revision: entry.entity.revision }))
  await runNotionAuthorBackfill(plan, { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(stored), apply }, new AbortController().signal, () => {})
  expect(apply.mock.calls[0][0].entity.aliases).toEqual(['Évelyne Bloch-Dano'])
  expect(apply.mock.calls[1][0].entity.authorIds).toHaveLength(1)
  expect(prepareNotionAuthorBackfill([(await fixture('另一位作者|Another Author')).stored]).candidates).toEqual([])
})
it('preserves existing credits and defers conflicting roles across imported rows', async () => {
  const { book, stored } = await fixture('原作：甲|漫畫：乙')
  expect(prepareNotionAuthorBackfill([{ ...stored, payload: { ...book, creatorCredits: [{ creatorId: 'manual', role: 'original' }] } as unknown as NonNullable<StoredRemoteEntity['payload']> }])).toMatchObject({ candidates: [], preserved: 1 })
  const notes = book.importSourceNotes! + '\n【來源第 3 列】\n作者：原作：乙|漫畫：甲\n來源：測試'
  expect(prepareNotionAuthorBackfill([{ ...stored, payload: { ...book, importSourceNotes: notes } as unknown as NonNullable<StoredRemoteEntity['payload']> }])).toMatchObject({ candidates: [], unresolved: [{ reason: '角色、別名或原文結構需要另行判斷' }] })
})
it('validates optional credits on books and works without changing legacy compatibility', async () => {
  const { book } = await fixture()
  for (const credits of [[{ creatorId: '', role: 'original' }], [{ creatorId: 'id', role: 'unknown' }], [{ creatorId: 'id', role: 'original' }, { creatorId: 'id', role: 'original' }]]) {
    const malformed = { ...book, creatorCredits: credits as CreatorCredit[] }
    expect(() => assertValidBook(malformed)).toThrow()
    expect(() => assertValidWork(migrateBookToWork(malformed))).toThrow()
  }
  expect(() => assertValidBook(book)).not.toThrow()
})


it('resolves newly verified name-bearing URLs without interpreting unknown query values', async () => {
  const urls = Object.entries(NOTION_AUTHOR_URL_EVIDENCE).slice(-12)
  expect(urls).toHaveLength(12)
  for (const [url, name] of urls) {
    expect(prepareNotionAuthorBackfill([(await fixture(url)).stored]).candidates[0].names).toEqual([name])
    expect(resolveNotionAuthorUrl(`${url}?extra=1`)).toBeNull()
  }
})
it('uses public book credits only when the source author, title and page agree', async () => {
  const { book, stored } = await fixture('https://readmoo.com/publisher/189')
  const notes = `${book.importSourceNotes}\n網址：https://readmoo.com/book/210103048000101?utm_source=google`
  const correct = { ...stored, payload: { ...book, title: '簡明台灣人四百年', importSourceNotes: notes } as unknown as NonNullable<StoredRemoteEntity['payload']> }
  expect(prepareNotionAuthorBackfill([correct]).candidates[0].names).toEqual(['史明'])
  for (const payload of [
    { ...correct.payload, title: '另一個作品' },
    { ...correct.payload, importSourceNotes: notes.replace('/book/210103048000101', '/book/000000000000000') },
    { ...correct.payload, importSourceNotes: notes.replace('readmoo.com/book', 'readmoo.com.evil.test/book') },
    { ...correct.payload, importSourceNotes: notes.replace('網址：https://', '網址：https://user@') },
    { ...correct.payload, importSourceNotes: notes.replace('\n網址：', '\n【來源第 3 列】\n作者：\n來源：其他\n網址：') }
  ]) expect(prepareNotionAuthorBackfill([{ ...correct, payload }]).candidates).toEqual([])
  expect(resolveNotionAuthorUrl('https://readmoo.com/publisher/189')).toBeNull()
  expect(resolveNotionAuthorUrl('https://readmoo.com/contributor/131877')).toBeNull()
  expect(resolveNotionAuthorSource('https://readmoo.com/contributor/131877', { title: '發生在近畿某處的那些事', sourceUrls: ['https://readmoo.com/book/210340404000101?utm_source=test'] })?.names).toEqual(['背筋'])
  expect(resolveNotionAuthorSource('https://readmoo.com/contributor/131877', { title: '發生在近畿某處的那些事 (1)', sourceUrls: ['https://readmoo.com/book/210340404000101'] })).toBeNull()
})
it('matches verified whole multi-author cells and preserves original/author roles', async () => {
  const { stored } = await fixture('https://readmoo.com/contributor/1573https://readmoo.com/contributor/63338')
  expect(prepareNotionAuthorBackfill([stored]).candidates[0].names).toEqual(['丘美珍', '鄭仲嵐'])
  expect(prepareNotionAuthorBackfill([(await fixture('https://readmoo.com/contributor/1573https://readmoo.com/contributor/99999')).stored]).candidates).toEqual([])
  const raw = '京極夏彥 https://readmoo.com/contributor/33714'
  const { book, stored: rose } = await fixture(raw)
  const corrected = { ...rose, payload: { ...book, title: '薔薇十字叢書神社姬之森' } as unknown as NonNullable<StoredRemoteEntity['payload']> }
  const plan = prepareNotionAuthorBackfill([corrected])
  expect(plan.candidates[0].credits).toEqual([{ name: '京極夏彥', role: 'original' }, { name: '春日みかげ', role: 'author' }])
  expect(prepareNotionAuthorBackfill([rose]).candidates).toEqual([])
  const apply = vi.fn().mockImplementation(async (entry) => ({ ...corrected, kind: entry.kind, id: entry.entityId, payload: entry.entity, revision: entry.entity.revision }))
  await runNotionAuthorBackfill(plan, { list: vi.fn().mockResolvedValue([]), get: vi.fn().mockResolvedValue(corrected), apply }, new AbortController().signal, () => {})
  expect(apply.mock.calls[2][0].entity.creatorCredits.map((credit: CreatorCredit) => credit.role)).toEqual(['original', 'author'])
  expect(apply.mock.calls[2][0].entity.importSourceNotes).toBe(book.importSourceNotes)
})
