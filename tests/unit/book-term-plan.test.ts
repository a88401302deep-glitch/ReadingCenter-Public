import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { createMetadata } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { bookTermOptions, bookTermPresets } from '../../src/features/books/book-term-catalog'

const now = '2026-10-30T00:00:00.000Z'
const category = bookTermPresets('category').find(item => item.label === '文學小說')!
const tag = bookTermPresets('tag').find(item => item.label === '推理')!
it('materializes only chosen terms, preserving custom IDs and making saved options discoverable', async () => {
 const repositories = createInMemoryRepositories(), service = new BookService(repositories)
 expect(await repositories.dictionaries.getAll()).toEqual([])
 const book = await service.create({ title:'合成書', mediaTypeId:'ebook', categoryIds:[category.id], tagIds:[tag.id, 'custom-tag'] })
 expect(book.categoryIds).toEqual([category.id])
 expect(book.tagIds).toEqual([tag.id, 'custom-tag'])
 expect((await repositories.dictionaries.getAll()).map(entry => entry.name).sort()).toEqual(['文學小說', '推理'].sort())
 await service.update(book.id, { title:book.title, mediaTypeId:'ebook', categoryIds:[category.id], tagIds:[] }, book.revision)
 expect((await repositories.dictionaries.getAll())).toHaveLength(2)
 expect((await service.get(book.id))?.tagIds).toEqual([])
})
it('reuses normalized existing names without renaming or merging custom entries', async () => {
 const repositories = createInMemoryRepositories(), service = new BookService(repositories)
 const entry = { ...createMetadata({id:'manual-category', now}), kind:'category' as const, name:' 文學小說 ', color:'#abc' }
 await repositories.dictionaries.save(entry)
 expect(bookTermOptions('category', [entry]).filter(item => item.label.trim() === '文學小說')).toEqual([{id:entry.id, label:entry.name}])
 const book = await service.create({title:'合成書', mediaTypeId:'ebook', categoryIds:[category.id, entry.id]})
 expect(book.categoryIds).toEqual([entry.id])
 expect(await repositories.dictionaries.getAll()).toEqual([entry])
})
it('rejects conflicts, stale writes and invalid books before adding preset dictionaries', async () => {
 const repositories = createInMemoryRepositories(), service = new BookService(repositories)
 const book = await service.create({title:'人工資料', mediaTypeId:'ebook', categoryIds:['legacy-category']})
 await expect(service.update(book.id, {title:'人工資料', mediaTypeId:'ebook', categoryIds:[category.id]}, 0)).rejects.toThrow('新版本')
 await expect(service.create({title:'', mediaTypeId:'ebook', categoryIds:[category.id]})).rejects.toThrow()
 expect(await repositories.dictionaries.getAll()).toEqual([])
 await repositories.dictionaries.save({...createMetadata({id:category.id,now}),kind:'tag',name:'人工標籤',color:null})
 await expect(service.update(book.id, {title:'人工資料',mediaTypeId:'ebook',categoryIds:[category.id]},book.revision)).rejects.toThrow('衝突')
 expect(await service.get(book.id)).toEqual(book)
 expect(await repositories.dictionaries.getAll()).toHaveLength(1)
})
it('allows empty classification without creating a vocabulary or guessing from the title', async () => {
 const repositories = createInMemoryRepositories(), service = new BookService(repositories)
 const book = await service.create({title:'推理',mediaTypeId:'ebook'})
 expect(book.categoryIds).toEqual([])
 expect(book.tagIds).toEqual([])
 expect(await repositories.dictionaries.getAll()).toEqual([])
})
