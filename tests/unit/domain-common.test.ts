import { describe, expect, it } from 'vitest'
import { createMetadata, updateEntity } from '../../src/domain'

describe('entity metadata', () => {
  it('creates stable metadata with revision one', () => {
    expect(createMetadata({ id: 'book-1', now: '2026-09-14T04:00:00Z' })).toEqual({
      id: 'book-1',
      createdAt: '2026-09-14T04:00:00Z',
      updatedAt: '2026-09-14T04:00:00Z',
      revision: 1,
      schemaVersion: 1,
      provenance: { kind: 'manual' }
    })
  })

  it('updates data without changing id or createdAt', () => {
    const original = {
      ...createMetadata({ id: 'book-1', now: '2026-09-14T04:00:00Z' }),
      title: '原書名'
    }
    const updated = updateEntity(
      original,
      { title: '新書名', id: 'illegal-id', createdAt: '2099-01-01T00:00:00Z' } as never,
      '2026-09-14T05:00:00Z'
    )

    expect(updated).toMatchObject({
      id: 'book-1',
      createdAt: '2026-09-14T04:00:00Z',
      updatedAt: '2026-09-14T05:00:00Z',
      revision: 2,
      title: '新書名'
    })
  })
})
