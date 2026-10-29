import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { expect, it, vi } from 'vitest'
import { createSyncingIndexedDbRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { bookTermPresets } from '../../src/features/books/book-term-catalog'

it('rolls back preset dictionaries and sync mutations if saving the book fails', async () => {
 const name = `book-terms-rollback-${crypto.randomUUID()}`, local = createSyncingIndexedDbRepositories(name)
 try {
  const service = new BookService(local.repositories)
  const save = vi.spyOn(local.repositories.books, 'save').mockRejectedValueOnce(new Error('synthetic storage failure'))
  await expect(service.create({title:'合成書',mediaTypeId:'ebook',categoryIds:[bookTermPresets('category')[0].id],tagIds:[bookTermPresets('tag')[0].id]})).rejects.toThrow('synthetic storage failure')
  save.mockRestore()
  expect(await local.repositories.dictionaries.getAll()).toEqual([])
  expect(await local.repositories.books.getAll()).toEqual([])
  expect(await local.database.syncOutbox.toArray()).toEqual([])
 } finally { local.close(); await Dexie.delete(name) }
})

it('persists selected vocabulary across reopening and queues dictionaries before the book', async () => {
 const name = `book-terms-persist-${crypto.randomUUID()}`, first = createSyncingIndexedDbRepositories(name)
 try {
  const category = bookTermPresets('category')[0], tag = bookTermPresets('tag')[0]
  const service = new BookService(first.repositories)
  const book = await service.create({title:'合成書',mediaTypeId:'ebook',categoryIds:[category.id],tagIds:[tag.id]})
  const queue = await first.database.syncOutbox.toArray()
  expect(queue.map(row => row.kind)).toEqual(['dictionary','dictionary','book'])
  first.close()
  const second = createSyncingIndexedDbRepositories(name)
  try {
   expect(await second.repositories.books.getById(book.id)).toMatchObject({categoryIds:[category.id],tagIds:[tag.id]})
   expect((await second.repositories.dictionaries.getAll()).map(entry=>entry.name).sort()).toEqual([category.label,tag.label].sort())
  } finally { second.close() }
 } finally { first.close(); await Dexie.delete(name) }
})
