// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { BookPublicationList } from '../../src/features/library/BookPublicationList'

it('hides empty publication fields while retaining filled data and pending dictionary references', async () => {
  const book = await new BookService(createInMemoryRepositories()).create({ title: '已填資料', mediaTypeId: 'ebook', isbn: '9780140328721', categoryIds: ['pending-category'] })
  const { container } = render(<BookPublicationList hideEmpty showMissingIcons={false} book={book} dictionaries={[]} collections={[]} mediaTypeName="電子書" />)
  expect([...container.querySelectorAll('dt')].map(el => el.textContent)).toEqual(['ISBN', '書籍版本', '圖書分類'])
  expect(screen.getByText('9780140328721')).toBeTruthy()
  expect(screen.getByText('資料待載入')).toBeTruthy()
  expect(screen.queryByText('未提供')).toBeNull()
})

it('shows all book fields with accessible pending icons without duplicating the title or inventing values', async () => {
  const book = await new BookService(createInMemoryRepositories()).create({ title: '僅有書名', mediaTypeId: 'ebook' })
  const { container } = render(<BookPublicationList book={book} dictionaries={[]} collections={[]} mediaTypeName="電子書" />)
  expect(container.querySelectorAll('dt')).toHaveLength(13)
  expect(screen.getAllByRole('img')).toHaveLength(12)
  for (const label of ['作者', '譯者', '繪者', '原文書名', '作者原名', '出版社', 'ISBN', '出版日期', '圖書分類', '書籍字數', '系列', '卷次／集數']) expect(screen.getByRole('img', { name: label + '待編輯' })).toBeTruthy()
  expect(screen.queryByText('僅有書名')).toBeNull()
  expect(container.textContent).not.toMatch(/未設定|未知|0 字/)
})

it('renders actual creator roles, publication data and counts without changing the saved book', async () => {
  const repositories = createInMemoryRepositories()
  const service = new BookService(repositories)
  const book = await service.create({ title: '譯作', mediaTypeId: 'ebook', authorNames: ['作者甲'], translatorNames: ['譯者乙'], illustratorNames: ['繪者丙'], publisherName: '出版社丁', originalTitle: 'Original', isbn: '9780140328721', wordCount: 123456, publishedOn: '2024', authorOriginalNames: ['Author'] })
  const { container } = render(<BookPublicationList book={book} dictionaries={await repositories.dictionaries.getAll()} collections={[]} mediaTypeName="電子書" />)
  for (const value of ['作者甲', '譯者乙', '繪者丙', '出版社丁', 'Original', '9780140328721', '123,456 字', '2024', 'Author']) expect(screen.getByText(value)).toBeTruthy()
  expect(container.querySelector('dt')?.textContent).toBe('作者')
  expect(screen.queryByRole('img', { name: '譯者待編輯' })).toBeNull()
  expect(await service.get(book.id)).toEqual(book)
})

it('distinguishes unloaded references from missing data and preserves legacy author display', async () => {
  const book = await new BookService(createInMemoryRepositories()).create({ title: '舊資料', mediaTypeId: 'ebook', authorNames: ['作者甲'], categoryIds: ['unloaded-category'] })
  render(<BookPublicationList book={{ ...book, creatorCredits: undefined }} dictionaries={[]} collections={[]} mediaTypeName="電子書" />)
  expect(screen.getAllByText('資料待載入')).toHaveLength(2)
  expect(screen.queryByRole('img', { name: '作者待編輯' })).toBeNull()
  expect(screen.queryByText('unloaded-category')).toBeNull()
})
