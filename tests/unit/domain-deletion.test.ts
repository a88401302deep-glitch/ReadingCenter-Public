import { describe, expect, it } from 'vitest'
import { deletionPolicy } from '../../src/domain'

describe('deletion policy', () => {
  it('requires confirmation and cascades owned data when deleting a book', () => {
    expect(deletionPolicy.book).toMatchObject({
      requiresConfirmation: true,
      readingCycles: 'cascade',
      readingRecords: 'cascade',
      readingContents: 'cascade'
    })
  })

  it('retains content but detaches it when deleting a reading record', () => {
    expect(deletionPolicy.readingRecord.readingContents).toBe('detach')
  })
})
