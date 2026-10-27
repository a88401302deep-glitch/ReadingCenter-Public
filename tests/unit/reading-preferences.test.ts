import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { assertValidReadingPreferences, defaultMonthColors, readingPreferencesId, createMetadata } from '../../src/domain'
import { saveMonthColors } from '../../src/features/reading-overview/reading-preferences-service'
const now = '2026-10-04T00:00:00.000Z'
it('preserves the established palette, normalizes saved colors and rejects stale edits', async () => {
  const tokens = readFileSync(new URL('../../src/shared/styles/tokens.css', import.meta.url), 'utf8')
  expect([...tokens.matchAll(/--month-\d{2}: (#[0-9a-f]{6})/g)].map(match => match[1])).toEqual([...defaultMonthColors])
  const repositories = createInMemoryRepositories(), colors: string[] = [...defaultMonthColors]
  colors[0] = '#ABCDEF'
  const first = await saveMonthColors(repositories, colors, 0, now)
  colors[0] = '#000000'
  expect(first.monthColors[0]).toBe('#abcdef')
  await expect(saveMonthColors(repositories, colors, 0, now)).rejects.toThrow('新版本')
  const reset = await saveMonthColors(repositories, [...defaultMonthColors], 1, now)
  expect(reset).toMatchObject({ createdAt: first.createdAt, revision: 2, monthColors: [...defaultMonthColors] })
})
it('rejects malformed or unsafe palettes and sparse arrays', () => {
  const value = { ...createMetadata({ id: readingPreferencesId, now }), monthColors: [...defaultMonthColors] }
  for (const monthColors of [[], [...defaultMonthColors, '#ffffff'], Array(12), [...defaultMonthColors.slice(0, 11), 'url(https://invalid.test)'], [...defaultMonthColors.slice(0, 11), '#fff']]) expect(() => assertValidReadingPreferences({ ...value, monthColors })).toThrow()
  expect(() => assertValidReadingPreferences({ ...value, id: 'other' })).toThrow()
})
