import { describe, expect, it } from 'vitest'
import { getBookDisplayTitle, type Book } from '../../src/domain'
import { searchForms } from '../../src/features/library/library-query'

const book = (preferredTitle: string | null): Pick<Book, 'preferredTitle' | 'title'> => ({
  title: '斗羅大陸',
  preferredTitle
})

describe('book language rules', () => {
  it('uses a manual preferred title and falls back to the untouched source title', () => {
    expect(getBookDisplayTitle(book('鬥羅大陸'))).toBe('鬥羅大陸')
    expect(getBookDisplayTitle(book(null))).toBe('斗羅大陸')
    expect(getBookDisplayTitle(book('  '))).toBe('斗羅大陸')
  })

  it('builds both Traditional and Simplified Chinese search forms', () => {
    expect(searchForms('阅读')).toContain('閱讀')
    expect(searchForms('閱讀')).toContain('閱讀')
  })
})
