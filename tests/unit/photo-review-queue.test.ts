import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { PhotoReviewQueue, recognizeQueuedPhoto, PhotoRecognitionError } from '../../src/import/photo-review-queue'
vi.mock('../../src/import/photo-book', async original => ({ ...await original<typeof import('../../src/import/photo-book')>(), preparePhoto: vi.fn(async () => new Blob(['prepared'], { type: 'image/jpeg' })) }))
const queues: PhotoReviewQueue[] = []
afterEach(async () => { for (const queue of queues.splice(0)) { queue.close(); await queue.delete() } })
function queue() { const value = new PhotoReviewQueue('queue-' + crypto.randomUUID()); queues.push(value); return value }
it('persists compressed images and corrected drafts across reopen, and deduplicates simultaneous same-file additions', async () => {
 const value = queue(), file = new File(['image'], 'cover.png', { type: 'image/png' })
 const added = await Promise.all([value.add(file, '讀墨'), value.add(file, '讀墨')])
 expect(added[0].id).toBe(added[1].id); expect(added.filter(row => row.duplicate)).toHaveLength(1)
 await value.patch(added[0].id, { draft: { title: '修正書名', author: '作者', publisher: '', isbn: '', visibleText: '原文' }, bookId: 'existing-book', mediaType: 'print', allowSameTitle: true })
 const name = value.name; value.close()
 const reopened = new PhotoReviewQueue(name); queues.push(reopened)
 expect((await reopened.list())[0]).toMatchObject({ source: '讀墨', draft: { title: '修正書名' }, bookId: 'existing-book', mediaType: 'print', allowSameTitle: true, image: expect.any(ArrayBuffer) })
})
it('retains completed metadata and dedup evidence while releasing the photo and rejects missing rows', async () => {
 const value = queue(), file = new File(['image'], 'cover.png', { type: 'image/png' }), added = await value.add(file)
 await value.finish(added.id, 'book')
 expect((await value.list())[0]).toMatchObject({ status: 'saved', image: null, savedBookId: 'book' })
 expect((await value.add(file)).duplicate).toBe(true)
 await value.remove(added.id); expect(await value.list()).toEqual([])
 await expect(value.patch(added.id, { source: '其他' })).rejects.toThrow('不存在')
})
it('enforces the 20 pending image limit and file validation without dropping existing drafts', async () => {
 const value = queue()
 for (let index = 0; index < 20; index++) await value.add(new File([String(index)], `${index}.png`, { type: 'image/png' }))
 await expect(value.add(new File(['next'], 'next.png', { type: 'image/png' }))).rejects.toThrow('20 張')
 await expect(value.add(new File(['invalid'], 'bad.txt', { type: 'text/plain' }))).rejects.toThrow('JPEG')
 expect(await value.list()).toHaveLength(20)
})
it('accepts bounded OCR strings and exposes quota/service/network failures for stopping a batch', async () => {
 const draft = { title: '書名', author: '', publisher: '', isbn: '', visibleText: '原文' }, image = new Blob(['jpeg'])
 const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: draft }))
 expect(await recognizeQueuedPhoto(image, undefined, request)).toEqual([draft])
 expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', credentials: 'include' })
 for (const status of [401,429,503]) {
  await expect(recognizeQueuedPhoto(image, undefined, vi.fn().mockResolvedValue(Response.json({ error: { message: '停止' } }, { status })))).rejects.toMatchObject({ status })
 }
 await expect(recognizeQueuedPhoto(image, undefined, vi.fn().mockRejectedValue(new TypeError('offline')))).rejects.toBeInstanceOf(PhotoRecognitionError)
 await expect(recognizeQueuedPhoto(image, undefined, vi.fn().mockResolvedValue(Response.json({ data: { ...draft, title: 'x'.repeat(301) } })))).rejects.toThrow('無效')
})
it('keeps candidates independent and retains the shared photo until every book is confirmed or skipped', async () => {
 const value = queue(), added = await value.add(new File(['list'], 'list.png', { type: 'image/png' }), '微信讀書')
 const draft = { title: '第一本', author: '', publisher: '', isbn: '', visibleText: '清單' }
 await value.setCandidates(added.id, [draft, { ...draft, title: '第二本' }])
 let item = (await value.list())[0]
 await value.patchCandidate(added.id, item.candidates![1].id, { draft: { ...draft, title: '第二本修正' }, bookId: 'existing' })
 await value.finish(added.id, 'book-one', item.candidates![0].id)
 item = (await value.list())[0]
 expect(item.status).toBe('ready'); expect(item.image).not.toBeNull()
 expect(item.candidates![1]).toMatchObject({ draft: { title: '第二本修正' }, bookId: 'existing', status: 'pending' })
 await expect(value.setCandidates(added.id, [draft])).rejects.toThrow('已有確認')
 await value.patchCandidate(added.id, item.candidates![1].id, { status: 'ignored' })
 expect((await value.list())[0]).toMatchObject({ status: 'saved', image: null })
})
it('deduplicates identical OCR rows but keeps same-title different editions', async () => {
 const draft = { title: '同名', author: '作者', publisher: '', isbn: '', visibleText: '原文' }
 const result = await recognizeQueuedPhoto(new Blob(), undefined, vi.fn().mockResolvedValue(Response.json({ data: { books: [draft,draft,{ ...draft,isbn:'9781234567890' }] } })))
 expect(result).toHaveLength(2)
 const value = queue(), added = await value.add(new File(['edition'],'edition.png',{type:'image/png'}))
 await value.setCandidates(added.id,result)
 expect((await value.list())[0].candidates?.map(row=>row.variant)).toEqual(['variant:作者','variant:9781234567890'])
})
it('keeps publisher editions distinct through recognition, queueing and confirmation', async () => {
 const { confirmPhotoBook } = await import('../../src/import/photo-book')
 const { createInMemoryRepositories } = await import('../../src/data')
 const draft = { title: '同名書', author: '作者', publisher: '甲出版社', isbn: '', visibleText: '原文' }
 const drafts = await recognizeQueuedPhoto(new Blob(), undefined, vi.fn().mockResolvedValue(Response.json({ data: { books: [draft, draft, { ...draft, publisher: '乙出版社' }] } })))
 expect(drafts).toHaveLength(2)
 const value = queue(), added = await value.add(new File(['publishers'], 'publishers.png', { type: 'image/png' }))
 await value.setCandidates(added.id, drafts)
 const item = (await value.list())[0], candidates = item.candidates!
 expect(new Set(candidates.map(row => row.variant)).size).toBe(2)
 const repo = createInMemoryRepositories()
 for (const candidate of candidates) {
  const book = await confirmPhotoBook(repo, candidate.draft, { hash: item.hash, bookId: null, source: '其他', mediaType: 'ebook', allowSameTitle: true, candidateKey: candidate.variant })
  await value.finish(item.id, book.id, candidate.id)
 }
 expect(await repo.books.getAll()).toHaveLength(2)
 expect(await repo.readingRecords.getAll()).toEqual([])
 expect((await repo.books.getAll()).every(book => book.cover === null)).toBe(true)
})

it('retains separate reading dates and corrections per candidate across reopening before confirmation', async () => {
 const value = queue(), added = await value.add(new File(['dates'], 'dates.png', { type: 'image/png' }))
 const base = { title: '閱讀中', author: '', publisher: '', isbn: '', visibleText: '日期' }
 const drafts = await recognizeQueuedPhoto(new Blob(), undefined, vi.fn().mockResolvedValue(Response.json({ data: { books: [
  { ...base, progressPercent: '0', startedOn: '2026-09-01', lastReadOn: '2026-10-04', completedOn: '' },
  { ...base, title: '已讀完', completedOn: '2026-10-02' }
 ] } })))
 await value.setCandidates(added.id, drafts)
 const item = (await value.list())[0]
 expect(item.candidates![0].reading).toMatchObject({ status: 'reading', progressPercent: '0', startedOn: '2026-09-01', lastReadOn: '2026-10-04', completedOn: '' })
 expect(item.candidates![1].reading).toMatchObject({ status: 'completed', startedOn: '', lastReadOn: '', completedOn: '2026-10-02' })
 await value.patchReading(item.id, item.candidates![0].id, { ...item.candidates![0].reading!, lastReadOn: '2026-10-03' })
 const name = value.name; value.close()
 const reopened = new PhotoReviewQueue(name); queues.push(reopened)
 const rows = await reopened.list()
 expect(rows[0].candidates![0].reading).toMatchObject({ status: 'reading', progressPercent: '0', lastReadOn: '2026-10-03' })
 expect(rows[0].candidates![1].reading?.completedOn).toBe('2026-10-02')
 for (const key of ['startedOn', 'lastReadOn', 'progressPercent']) await expect(recognizeQueuedPhoto(new Blob(), undefined, vi.fn().mockResolvedValue(Response.json({ data: { ...base, [key]: 123 } })))).rejects.toThrow('無效')
})
