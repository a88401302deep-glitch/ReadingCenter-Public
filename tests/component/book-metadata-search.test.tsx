// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BookForm } from '../../src/features/books/BookForm'
import { createInMemoryRepositories } from '../../src/data/in-memory-repositories'
import { BookService } from '../../src/features/books/book-service'
import { uploadBookCover } from '../../src/features/books/book-cover-upload'
import { BookMetadataSearch } from '../../src/features/books/BookMetadataSearch'
import genericBookHtml from '../fixtures/book-metadata/kadokawa-9786264002769.html?raw'
import { parseKadokawaBook } from '../../worker/kadokawa-book-metadata'
import { handleBookMetadataSearch, parseGoogleVolumes } from '../../worker/book-metadata-search'
import googleKyoto from '../fixtures/book-metadata/google-kyoto-diagnostic.json'
vi.mock('../../src/features/books/book-cover-upload', async original => ({ ...await original<typeof import('../../src/features/books/book-cover-upload')>(), uploadBookCover: vi.fn(async () => ({ path: '/api/v1/covers/covers/saved.jpg', mimeType: 'image/jpeg' as const })) }))
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks() })
it.each(['', '人工作者'])('does not bring placeholder authors into the draft and preserves existing author %j', async existingAuthor => {
 const [candidate] = parseGoogleVolumes({ items: [{ id: '0MXpEAAAQBAJ', volumeInfo: { title: '異世界漫步 (3) ∼艾法魔導國．散步篇∼', authors: ['?????'], publisher: '台灣角川', industryIdentifiers: [{ type: 'ISBN_13', identifier: '9786263782433' }] } }] })
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [candidate] })))
 const submit = vi.fn()
 render(<BookForm onCancel={vi.fn()} onSubmit={submit} />)
 fireEvent.change(screen.getByLabelText('出版書名', { exact: true }), { target: { value: candidate.title } })
 if (existingAuthor) fireEvent.change(screen.getByLabelText('作者（每行一位）'), { target: { value: existingAuthor } })
 fireEvent.click(screen.getByText('搜尋並補全書籍資料'))
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 fireEvent.click(await screen.findByRole('button', { name: '核對《' + candidate.title + '》' }))
 fireEvent.click(screen.getByRole('button', { name: '帶入下列表單' }))
 expect(screen.getByLabelText('作者（每行一位）')).toHaveProperty('value', existingAuthor)
 expect(screen.getByLabelText('出版社', { exact: true })).toHaveProperty('value', '台灣角川')
 expect(screen.getByLabelText('ISBN', { exact: true })).toHaveProperty('value', '9786263782433')
 expect(screen.queryByText('?????')).toBeNull()
 expect(submit).not.toHaveBeenCalled()
 expect(uploadBookCover).not.toHaveBeenCalled()
})
it('brings a recovered Chinese Google candidate from the handler into the unsaved draft', async () => {
 const upstream = vi.fn(async (input: URL | string | Request) => {
  const url = new URL(String(input))
  if (url.hostname !== 'www.googleapis.com') return new Response('', { status: 503 })
  return Response.json(url.searchParams.get('q')?.startsWith('intitle:') ? { totalItems: 0 } : googleKyoto)
 })
 vi.stubGlobal('fetch', vi.fn((input: string) => handleBookMetadataSearch(new Request('https://app.test' + input), 'test-key', upstream)))
 const submit = vi.fn()
 render(<BookForm onCancel={vi.fn()} onSubmit={submit} />)
 fireEvent.change(screen.getByLabelText('出版書名', { exact: true }), { target: { value: '京都怪奇談' } })
 fireEvent.click(screen.getByText('搜尋並補全書籍資料'))
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 fireEvent.click((await screen.findAllByRole('button', { name: '核對《京都怪奇談》' }))[0])
 expect(screen.queryByRole('button', { name: '核對《佛經預言》' })).toBeNull()
 fireEvent.click(screen.getByRole('button', { name: '帶入下列表單' }))
 expect(screen.getByLabelText('作者（每行一位）')).toHaveProperty('value', '三木大雲')
 expect(screen.getByLabelText('出版社', { exact: true })).toHaveProperty('value', '大牌出版')
 expect(screen.getByLabelText('ISBN', { exact: true })).toHaveProperty('value', '9786267305126')
 expect(submit).not.toHaveBeenCalled()
 expect(uploadBookCover).not.toHaveBeenCalled()
 expect(upstream.mock.calls.filter(([url]) => new URL(String(url)).hostname === 'www.googleapis.com')).toHaveLength(2)
})
it('distinguishes partial source failure from a successful empty search and retries without caching the failure', async () => {
 const request = vi.fn().mockResolvedValueOnce(Response.json({ data: [], partial: true, warnings: ['讀書共和國目前導向官方維護公告，暫時無法搜尋。'] })).mockResolvedValueOnce(Response.json({ data: [], partial: false }))
 vi.stubGlobal('fetch', request)
 const cache = new Map(), select = vi.fn()
 render(<BookMetadataSearch title="京都怪奇談" author="" disabled={false} onSelect={select} lookupCache={cache} />)
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('讀書共和國目前導向官方維護公告'))
 expect(screen.queryByText(/^查無書目資料/)).toBeNull()
 expect(screen.getByLabelText('查詢書名')).toHaveProperty('value', '京都怪奇談')
 expect(cache.size).toBe(0)
 expect(select).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: '重試搜尋' }))
 expect(await screen.findByText(/^查無書目資料/)).toBeTruthy()
 expect(screen.queryByRole('alert')).toBeNull()
 expect(request).toHaveBeenCalledTimes(2)
})
it('brings a generic-category Chinese book into the draft without guessing its form or saving', async () => {
 const candidate = parseKadokawaBook(genericBookHtml, '9786264002769')
 const request = vi.fn(async () => Response.json({ data: [candidate], partial: true }))
 vi.stubGlobal('fetch', request)
 const submit = vi.fn()
 render(<BookForm onCancel={vi.fn()} onSubmit={submit} />)
 fireEvent.change(screen.getByLabelText('出版書名', { exact: true }), { target: { value: candidate.title } })
 fireEvent.click(screen.getByText('搜尋並補全書籍資料'))
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 fireEvent.click(await screen.findByRole('button', { name: '核對《發生在近畿某處的那些事》' }))
 fireEvent.click(screen.getByRole('button', { name: '帶入下列表單' }))
 expect(screen.getByLabelText('作者（每行一位）')).toHaveProperty('value', '背筋')
 expect(screen.getByLabelText('出版社', { exact: true })).toHaveProperty('value', '台灣角川')
 expect(screen.getByLabelText('出版書名', { exact: true })).toHaveProperty('value', candidate.title)
 expect(submit).not.toHaveBeenCalled()
 expect(uploadBookCover).not.toHaveBeenCalled()
 expect(request).toHaveBeenCalledTimes(1)
})
it('uses newly entered book fields until the user customizes the query', () => {
 const props = { disabled: false, onSelect: vi.fn() }
 const { rerender } = render(<BookMetadataSearch {...props} title="" author="" />)
 rerender(<BookMetadataSearch {...props} title="京都怪奇談" author="三木大雲" />)
 expect(screen.getByLabelText('查詢書名')).toHaveProperty('value', '京都怪奇談')
 expect(screen.getByLabelText('查詢作者（選填）')).toHaveProperty('value', '三木大雲')
 fireEvent.change(screen.getByLabelText('查詢書名'), { target: { value: '京都怪奇談3' } })
 fireEvent.change(screen.getByLabelText('查詢作者（選填）'), { target: { value: '' } })
 rerender(<BookMetadataSearch {...props} title="另一書名" author="另一作者" />)
 expect(screen.getByLabelText('查詢書名')).toHaveProperty('value', '京都怪奇談3')
 expect(screen.getByLabelText('查詢作者（選填）')).toHaveProperty('value', '')
})
it('keeps searches and cover choices in an editable preview until saving; preserves existing fields by default', async () => {
 URL.createObjectURL = vi.fn(() => 'blob:metadata'); URL.revokeObjectURL = vi.fn()
 const candidate = { id: 'ol:OL1M', source: 'Open Library', title: '候選書名', authors: ['甲', '乙'], publisher: '候選出版社', isbn: '9781234567890', publishedOn: '2025', sourceUrl: 'https://openlibrary.org/books/OL1M', coverUrl: '/api/v1/books/metadata/cover?path=test' }
 const request = vi.fn().mockImplementation(async url => String(url).includes('/cover?') ? new Response(new Uint8Array([255, 216, 255, 217]), { headers: { 'Content-Type': 'image/jpeg' } }) : Response.json({ data: [candidate] }))
 vi.stubGlobal('fetch', request)
 const repo = createInMemoryRepositories(), book = await new BookService(repo).create({ title: '人工書名', mediaTypeId: 'ebook', authorNames: ['人工作者'], publisherName: '人工出版社' })
 const submit = vi.fn(async () => undefined)
 render(<BookForm book={book} dictionaries={await repo.dictionaries.getAll()} onCancel={vi.fn()} onSubmit={submit} />)
 fireEvent.click(screen.getByText('搜尋並補全書籍資料'))
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 fireEvent.click(await screen.findByRole('button', { name: '核對《候選書名》' }))
 fireEvent.click(screen.getByText('調整帶入欄位或取代既有資料'))
 fireEvent.click(screen.getByRole('button', { name: '帶入下列表單' }))
 expect(screen.getByLabelText('作者（每行一位）')).toHaveProperty('value', '人工作者')
 expect(screen.getByLabelText('出版社', { exact: true })).toHaveProperty('value', '人工出版社')
 expect(screen.getByLabelText('ISBN', { exact: true })).toHaveProperty('value', '9781234567890')
 expect(submit).not.toHaveBeenCalled()
 expect((await repo.books.getAll())[0]).toEqual(book)
 fireEvent.click(screen.getByLabelText('已核對版本，允許候選取代目前欄位'))
 fireEvent.click(screen.getByRole('button', { name: '帶入下列表單' }))
 expect(screen.getByLabelText('作者（每行一位）')).toHaveProperty('value', '甲\n乙')
 fireEvent.click(screen.getByRole('button', { name: '使用這張封面' }))
 await waitFor(() => expect(screen.getByAltText('封面預覽').getAttribute('src')).toBe('blob:metadata'))
 expect(uploadBookCover).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(submit).toHaveBeenCalledWith(expect.objectContaining({ title: '候選書名', authorNames: ['甲', '乙'], publisherName: '候選出版社', isbn: '9781234567890', publishedOn: '2025', metadataSourceUrl: candidate.sourceUrl, cover: { path: '/api/v1/covers/covers/saved.jpg', mimeType: 'image/jpeg' } })))
 expect(uploadBookCover).toHaveBeenCalledOnce()
})

it.each([
 [{ data: [], partial: true }, '部分來源搜尋失敗'],
 [{ data: [], partial: false, warning: 'Google Books 尚未啟用；目前僅查詢所選來源。' }, 'Google Books 尚未啟用'],
 [{ data: [{ title: 'invalid' }] }, '候選格式無法辨識'],
])('does not describe incomplete or rejected results as no matching books: %j', async (body, message) => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json(body)))
 const select = vi.fn()
 render(<BookMetadataSearch title="測試書名" author="" disabled={false} onSelect={select} />)
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 expect((await screen.findByRole('alert')).textContent).toContain(message)
 expect(screen.queryByText(/查無書目資料/)).toBeNull()
 expect(select).not.toHaveBeenCalled()
})

it('shows a genuine successful empty response as no matching books', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [], partial: false })))
 render(<BookMetadataSearch title="測試書名" author="" disabled={false} onSelect={vi.fn()} />)
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 expect(await screen.findByText(/查無書目資料/)).toBeTruthy()
})

it.each([200, 502])('shows individual source failures on HTTP %i without applying or saving a candidate', async status => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({
  ...(status === 200 ? { data: [], partial: true } : { error: { message: '搜尋來源暫時無法使用' } }),
  diagnostics: [{ source: 'Google Books', status: 'failed', kind: 'http', httpStatus: 403 }, { source: 'Open Library', status: 'empty', count: 0 }]
 }, { status })))
 const select = vi.fn()
 render(<BookMetadataSearch title="測試書名" author="" disabled={false} onSelect={select} />)
 fireEvent.click(screen.getByRole('button', { name: '查詢書籍資料' }))
 const list = await screen.findByRole('list', { name: '搜尋來源狀態' })
 expect(list.textContent).toContain('Google Books：HTTP 403')
 expect(list.textContent).toContain('Open Library：查詢成功，沒有候選')
 expect(screen.queryByText(/查無書目資料/)).toBeNull()
 expect(select).not.toHaveBeenCalled()
})
