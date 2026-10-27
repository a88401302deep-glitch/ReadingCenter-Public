import { expect, it } from 'vitest'
import { findMoonCoverCandidates } from '../../src/import/moon-cover-candidates'

it('finds same-folder numbered image variants as review candidates only', () => {
  expect(findMoonCoverCandidates('/covers/book_1.png', [
    '/covers/book_2.png', '/other/book_2.png', '/covers/other_2.png', '/covers/book_2.jpg'
  ])).toEqual(['/covers/book_2.png'])
})

it('does not return the referenced path itself as an alternate candidate', () => {
  expect(findMoonCoverCandidates('/covers/book_1.png', ['/covers/book_1.png'])).toEqual([])
})
