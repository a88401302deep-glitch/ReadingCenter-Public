import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { confirmPhotoBook, matchPhotoBooks } from '../../src/import/photo-book'
async function books() {
 const repo = createInMemoryRepositories()
 for (const [index, title] of ['同名延伸', '同名', '另一書名'].entries()) {
  await confirmPhotoBook(repo, { title, author: '', publisher: '', isbn: index === 2 ? '123456789X' : '', visibleText: '' }, { hash: String(index).repeat(64), bookId: null, source: '其他', mediaType: 'ebook', allowSameTitle: false })
 }
 return { repo, rows: await repo.books.getAll() }
}
it('finds an ISBN-only candidate and ranks ISBN, exact title, then partial title without writing', async () => {
 const { repo, rows } = await books()
 expect(matchPhotoBooks(rows, { title: '', isbn: ' 1-23456789x ' }).map(book => book.title)).toEqual(['另一書名'])
 expect(matchPhotoBooks(rows, { title: '同名', isbn: '123456789X' }).map(book => book.title)).toEqual(['另一書名', '同名', '同名延伸'])
 expect(matchPhotoBooks(rows, { title: '', isbn: '' })).toEqual([])
 expect(await repo.books.getAll()).toEqual(rows)
 expect(await repo.readingRecords.getAll()).toEqual([])
})
it('ranks ISBN matches before applying the 30-candidate limit', async () => {
 const { rows } = await books()
 const partials = Array.from({ length: 35 }, (_, index) => ({ ...rows[0], id: String(index), title: '同名延伸' + index }))
 const matches = matchPhotoBooks([...partials, rows[2]], { title: '同名', isbn: '123456789X' })
 expect(matches).toHaveLength(30)
 expect(matches[0].id).toBe(rows[2].id)
})
it('uses author names and aliases only to order title candidates when ISBN is missing', async () => {
 const { rows } = await books()
 const first = { ...rows[1], id: 'first', authorIds: ['author-b'] }
 const second = { ...rows[1], id: 'second', authorIds: ['author-a'] }
 const partial = { ...rows[0], authorIds: ['author-a'] }
 const names = { 'author-a': ['甲作者', '甲筆名'], 'author-b': ['乙作者'] }
 expect(matchPhotoBooks([first, second, partial], { title: '同名', author: '甲筆名', isbn: '' }, names).map(book => book.id)).toEqual(['second', 'first', partial.id])
 expect(matchPhotoBooks([first, second], { title: '同名', author: '', isbn: '' }, names).map(book => book.id)).toEqual(['first', 'second'])
 expect(matchPhotoBooks([first, second], { title: '同名', author: '未知作者', isbn: '' }, names)).toHaveLength(2)
 expect(matchPhotoBooks([first], { title: '無關作品', author: '乙作者', isbn: '' }, names)).toEqual([])
})
