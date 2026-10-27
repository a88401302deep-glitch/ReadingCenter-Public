import { describe, expect, it } from 'vitest'
import { getNotionPublisherDisplayProposal } from '../../src/import/notion-publisher-normalization'

describe('Notion publisher display proposals', () => {
  it('uses a storefront display name and retains the original separately', () => {
    expect(getNotionPublisherDisplayProposal('東立出版社')).toMatchObject({ displayName: '東立', evidenceUrl: expect.stringContaining('books.com.tw') })
    expect(getNotionPublisherDisplayProposal('皇冠文化有限公司')).toMatchObject({ displayName: '皇冠' })
    expect(getNotionPublisherDisplayProposal('皇冠文化')).toMatchObject({ displayName: '皇冠' })
  })

  it('leaves unverified or region-ambiguous publishers unresolved', () => {
    expect(getNotionPublisherDisplayProposal('角川')).toBeNull()
    expect(getNotionPublisherDisplayProposal('新经典文化')).toBeNull()
    expect(getNotionPublisherDisplayProposal('')).toBeNull()
  })
})
