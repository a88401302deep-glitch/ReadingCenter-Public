import { expect, it } from 'vitest'
import { getBookLanguageChoices, getBookLanguageName } from '../../src/shared/book-language'
it('uses shared Chinese labels while preserving original regional and case variants', () => {
 expect(getBookLanguageName('und')).toBe('未指定')
 expect(getBookLanguageName('ZH-hant')).toBe('繁體中文')
 expect(getBookLanguageName('en')).toBe('英文')
 expect(getBookLanguageChoices('EN-us')).toContainEqual({ value: 'EN-us', label: expect.stringContaining('EN-us') })
 expect(getBookLanguageChoices('fr')).toContainEqual({ value: 'fr', label: expect.stringContaining('法文') })
 expect(getBookLanguageName('not_a_tag')).toBe('not_a_tag')
 expect(getBookLanguageChoices('qaa').at(-1)?.value).toBe('qaa')
})
