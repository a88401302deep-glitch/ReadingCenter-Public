import { describe, expect, it } from 'vitest'
import { assertValidProgress } from '../../src/domain'

describe('reading progress', () => {
  it('uses null for unknown progress and accepts a real zero value', () => {
    expect(() => assertValidProgress(null)).not.toThrow()
    expect(() => assertValidProgress({ unit: 'percent', value: 0 })).not.toThrow()
  })

  it('rejects percentages over 100 and positions beyond total', () => {
    expect(() => assertValidProgress({ unit: 'percent', value: 101 })).toThrow()
    expect(() => assertValidProgress({ unit: 'page', value: 301, total: 300 })).toThrow()
  })
})
