// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BookCover } from '../../src/shared/ui/BookCover'

describe('BookCover', () => {
  it('renders a named fallback without an image source', () => {
    render(<BookCover title="唐草人偶" />)
    expect(screen.getByRole('img', { name: '唐草人偶無封面' }).textContent).toContain('唐草人偶')
  })

  it('renders a real image when a source exists', () => {
    render(<BookCover src="/covers/book.webp" title="唐草人偶" />)
    expect(screen.getByRole('img', { name: '唐草人偶封面' }).getAttribute('src')).toBe('/covers/book.webp')
  })
})
