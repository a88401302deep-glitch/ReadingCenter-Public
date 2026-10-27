import { describe, expect, it } from 'vitest'
import { isNavigationId, navigationItems } from '../../src/app/navigation'

describe('application navigation', () => {
  it('keeps the reading, library and notes with management access', () => {
    expect(navigationItems.map((item) => item.label)).toEqual(['閱讀', '書庫', '閱讀筆記', '管理'])
  })

  it('rejects unknown navigation ids', () => {
    expect(isNavigationId('library')).toBe(true)
    expect(isNavigationId('calendar')).toBe(false)
  })
})
