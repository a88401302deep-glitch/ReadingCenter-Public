import { describe, expect, it, vi } from 'vitest'
import {
  GraphAdapterError,
  GraphAppFolderAdapter,
  normalizeManagedPath,
  type AccessTokenProvider
} from '../../src/sync'

const tokenProvider: AccessTokenProvider = {
  getAccessToken: vi.fn(async () => 'secret-access-token')
}

const jsonResponse = (value: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(value), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  })

describe('GraphAppFolderAdapter', () => {
  it('reads only an encoded path under the app root without exposing the token', async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(
        'https://graph.microsoft.com/v1.0/me/drive/special/approot:/data/%E6%9B%B8%E7%B1%8D.json:/content'
      )
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer secret-access-token')
      return new Response('{"ok":true}', { headers: { etag: '"v1"' } })
    })
    const adapter = new GraphAppFolderAdapter({ tokenProvider, fetch: request as typeof fetch })
    await expect(adapter.read('data/書籍.json')).resolves.toEqual({
      path: 'data/書籍.json',
      content: '{"ok":true}',
      version: '"v1"'
    })
  })

  it.each([
    '../private.txt',
    '/drive/root.txt',
    'https://example.com/file',
    'data/../secret',
    'other/file.json',
    'data\\file.json'
  ])('rejects unsafe or unmanaged path %s', (path) => {
    expect(() => normalizeManagedPath(path)).toThrow()
  })

  it('uses If-Match and returns the same completed operation without a duplicate request', async () => {
    const request = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      expect(init?.method).toBe('PUT')
      expect(headers.get('If-Match')).toBe('"old"')
      expect(headers.get('client-request-id')).toBe('11111111-1111-4111-8111-111111111111')
      return jsonResponse({}, { headers: { etag: '"new"' } })
    })
    const adapter = new GraphAppFolderAdapter({ tokenProvider, fetch: request as typeof fetch })
    const write = {
      operationId: '11111111-1111-4111-8111-111111111111',
      kind: 'put' as const,
      path: 'manifest.json',
      content: '{}',
      expectedVersion: '"old"'
    }
    const first = await adapter.apply([write])
    const second = await adapter.apply([write])
    expect(first).toEqual(second)
    expect(request).toHaveBeenCalledOnce()
  })

  it('follows Graph delta pagination and preserves the final checkpoint', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        value: [{
          name: 'books.json',
          eTag: '"1"',
          parentReference: { path: '/drive/root:/Apps/ReadingCenter/data' }
        }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/special/approot/delta?$skiptoken=next'
      }))
      .mockResolvedValueOnce(jsonResponse({
        value: [{
          name: 'old.json',
          eTag: '"2"',
          deleted: {},
          parentReference: { path: '/drive/root:/Apps/ReadingCenter/data' }
        }],
        '@odata.deltaLink': 'https://graph.microsoft.com/v1.0/me/drive/special/approot/delta?$deltatoken=done'
      }))
    const adapter = new GraphAppFolderAdapter({ tokenProvider, fetch: request as typeof fetch })
    const result = await adapter.listChanges()
    expect(result.changes).toEqual([
      { path: 'data/books.json', deleted: false, version: '"1"' },
      { path: 'data/old.json', deleted: true, version: '"2"' }
    ])
    expect(result.nextCheckpoint).toContain('$deltatoken=done')
    expect(request).toHaveBeenCalledTimes(2)
  })

  it.each([
    [401, 'authentication', false],
    [403, 'authorization', false],
    [412, 'conflict', false],
    [429, 'throttled', true],
    [503, 'server', true]
  ] as const)('maps HTTP %s without leaking response content or credentials', async (status, code, retryable) => {
    const request = vi.fn(async () =>
      new Response('secret file body and secret-access-token', {
        status,
        headers: status === 429 ? { 'retry-after': '7' } : undefined
      })
    )
    const adapter = new GraphAppFolderAdapter({ tokenProvider, fetch: request as typeof fetch })
    let error: unknown
    try {
      await adapter.read('data/books.json')
    } catch (reason) {
      error = reason
    }
    expect(error).toBeInstanceOf(GraphAdapterError)
    expect(error).toMatchObject({ status, code, retryable })
    expect(String(error)).not.toContain('secret')
    if (status === 429) expect(error).toMatchObject({ retryAfterSeconds: 7 })
  })

  it('rejects a delta checkpoint outside Microsoft Graph', async () => {
    const adapter = new GraphAppFolderAdapter({ tokenProvider, fetch: vi.fn() as never })
    await expect(adapter.listChanges('https://example.com/steal-token')).rejects.toThrow(
      'checkpoint must stay inside'
    )
  })
})
