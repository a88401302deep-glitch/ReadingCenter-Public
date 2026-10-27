// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { BookCreators } from '../../src/features/library/BookCreators'
import { BookService } from '../../src/features/books/book-service'
import { createInMemoryRepositories } from '../../src/data'
import { createMetadata, type AuthorEntry } from '../../src/domain'

it('shows distinct role labels and aliases without leaking unresolved dictionary IDs', async () => {
  const book = await new BookService(createInMemoryRepositories()).create({ title: '測試', mediaTypeId: 'manga' })
  const dictionary: AuthorEntry = { ...createMetadata({ id: 'a', now: '2026-10-03T00:00:00.000Z' }), kind: 'author', name: '甲', color: null, aliases: ['Alias'] }
  book.authorIds = ['a']
  book.creatorCredits = [{ creatorId: 'a', role: 'illustration' }, { creatorId: 'notion:dictionary:unknown', role: 'supervision' }]
  const { rerender } = render(<BookCreators book={book} dictionaries={[dictionary]} />)
  expect(screen.getByText('繪圖｜甲（亦名：Alias）')).not.toBeNull()
  expect(screen.getByText('監修｜創作者資料未載入')).not.toBeNull()
  expect(screen.queryByText(/notion:dictionary:/)).toBeNull()
  rerender(<BookCreators book={{ ...book, creatorCredits: undefined }} dictionaries={[dictionary]} />)
  expect(screen.getByText('甲（亦名：Alias）')).not.toBeNull()
})
