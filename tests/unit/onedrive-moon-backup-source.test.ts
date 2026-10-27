import { describe, expect, it, vi } from 'vitest'
import {
  defaultMoonBackupFolderPath,
  moonBackupGraphScopes,
  OneDriveMoonBackupSource,
  type GraphAccessTokenProvider
} from '../../worker/onedrive-moon-backup-source'

const tokenProvider: GraphAccessTokenProvider = {
  getAccessToken: vi.fn(async scopes => {
    expect(scopes).toEqual(['Files.Read'])
    return 'graph-token'
  })
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('OneDriveMoonBackupSource', () => {
  it('lists only .mrpro files directly inside device folders under the configured path', async () => {
    const request = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer graph-token')
      if (url === 'https://graph.microsoft.com/v1.0/me/drive/root:/%E6%9B%B8%E7%B1%8D%E7%9B%B8%E9%97%9C/%E9%96%B1%E8%AE%80%E7%B4%80%E9%8C%84:/children') {
        return jsonResponse({ value: [
          { id: 'device-a', name: 'BOOX A', folder: { childCount: 3 } },
          { id: 'device-b', name: 'BOOX B', folder: { childCount: 2 } },
          { id: 'root-backup.mrpro', name: 'root-backup.mrpro', file: {} }
        ] })
      }
      if (url.endsWith('/items/device-a/children')) {
        return jsonResponse({ value: [
          { id: 'backup-a', name: '2026-10-08.mrpro', file: {}, eTag: 'etag-a', size: 120, lastModifiedDateTime: '2026-10-08T14:00:00Z' },
          { id: 'other-a', name: 'notes.txt', file: {} },
          { id: 'nested-a', name: 'nested', folder: { childCount: 1 } }
        ] })
      }
      if (url.endsWith('/items/device-b/children')) {
        return jsonResponse({ value: [
          { id: 'backup-b', name: 'AUTO.MRPRO', file: {}, eTag: 'etag-b' }
        ] })
      }
      throw new Error(`Unexpected Graph request: ${url}`)
    })
    const source = new OneDriveMoonBackupSource({ tokenProvider, fetch: request as typeof fetch })

    await expect(source.listBackups()).resolves.toEqual([
      {
        driveItemId: 'backup-a',
        deviceFolder: 'BOOX A',
        name: '2026-10-08.mrpro',
        eTag: 'etag-a',
        size: 120,
        lastModifiedDateTime: '2026-10-08T14:00:00Z'
      },
      {
        driveItemId: 'backup-b',
        deviceFolder: 'BOOX B',
        name: 'AUTO.MRPRO',
        eTag: 'etag-b',
        size: null,
        lastModifiedDateTime: null
      }
    ])
    expect(request).toHaveBeenCalledTimes(3)
    expect(tokenProvider.getAccessToken).toHaveBeenCalledTimes(3)
  })

  it('encodes the folder path and follows only Graph paging links', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        value: [{ id: 'device-a', name: 'BOOX A', folder: {} }],
        '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=next'
      }))
      .mockResolvedValueOnce(jsonResponse({ value: [
        { id: 'device-b', name: '大螢幕', folder: {} }
      ] }))
      .mockResolvedValueOnce(jsonResponse({ value: [
        { id: 'backup', name: '備份.mrpro', file: {} }
      ] }))
      .mockResolvedValueOnce(jsonResponse({ value: [] }))
    const source = new OneDriveMoonBackupSource({ tokenProvider, fetch: request as typeof fetch })

    await source.listBackups()

    expect(String(request.mock.calls[0][0])).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/root:/%E6%9B%B8%E7%B1%8D%E7%9B%B8%E9%97%9C/%E9%96%B1%E8%AE%80%E7%B4%80%E9%8C%84:/children'
    )
    expect(String(request.mock.calls[1][0])).toBe(
      'https://graph.microsoft.com/v1.0/me/drive/root/children?$skiptoken=next'
    )
    expect(moonBackupGraphScopes).toEqual(['Files.Read'])
    expect(defaultMoonBackupFolderPath).toBe('書籍相關/閱讀紀錄')
  })

  it('rejects a paging link that points outside the configured Graph drive', async () => {
    const request = vi.fn(async () => jsonResponse({
      value: [],
      '@odata.nextLink': 'https://example.com/steal-token'
    }))
    const source = new OneDriveMoonBackupSource({ tokenProvider, fetch: request as typeof fetch })

    await expect(source.listBackups()).rejects.toThrow('left the configured OneDrive endpoint')
  })

  it.each([
    [401, 'Microsoft sign-in is required'],
    [403, 'OneDrive read permission was denied'],
    [429, 'Microsoft Graph throttled the request'],
    [503, 'Microsoft Graph is temporarily unavailable']
  ])('returns a safe error for Graph status %s', async (status, message) => {
    const request = vi.fn(async () => jsonResponse({ error: 'private body' }, status))
    const source = new OneDriveMoonBackupSource({ tokenProvider, fetch: request as typeof fetch })

    await expect(source.listBackups()).rejects.toThrow(message)
    await expect(source.listBackups()).rejects.not.toThrow('private body')
  })

  it('rejects unsafe configured folder paths before making a request', () => {
    const request = vi.fn()
    expect(() => new OneDriveMoonBackupSource({
      tokenProvider,
      fetch: request as typeof fetch,
      folderPath: '../private'
    })).toThrow('unsafe path segment')
    expect(request).not.toHaveBeenCalled()
  })
})
