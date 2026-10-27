import { describe, expect, it, vi } from 'vitest'
import { OneDriveMoonBackupDownloader } from '../../worker/onedrive-moon-backup-download'
import type { GraphAccessTokenProvider, MoonBackupDriveFile } from '../../worker/onedrive-moon-backup-source'

const file: MoonBackupDriveFile = {
  driveItemId: 'backup-id',
  deviceFolder: 'BOOX TUCP',
  name: '2026-10-08.mrpro',
  eTag: 'etag-1',
  size: 3,
  lastModifiedDateTime: null
}

const tokenProvider: GraphAccessTokenProvider = {
  getAccessToken: vi.fn(async scopes => {
    expect(scopes).toEqual(['Files.Read'])
    return 'graph-token'
  })
}

describe('OneDriveMoonBackupDownloader', () => {
  it('downloads a listed backup without forwarding the Graph token to the pre-authenticated URL', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: 'https://download.example/file?sig=secret' }
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Length': '3' }
      }))
    const downloader = new OneDriveMoonBackupDownloader({ tokenProvider, fetch: request as typeof fetch })

    await expect(downloader.download(file)).resolves.toEqual(new Uint8Array([1, 2, 3]))
    expect(request).toHaveBeenCalledTimes(2)
    expect(new Headers(request.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer graph-token')
    expect(new Headers(request.mock.calls[1][1]?.headers).get('Authorization')).toBeNull()
    expect(request.mock.calls[1][1]?.redirect).toBe('manual')
  })

  it('rejects a non-HTTPS download location before making a second request', async () => {
    const request = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { Location: 'http://download.example/file' }
    }))
    const downloader = new OneDriveMoonBackupDownloader({ tokenProvider, fetch: request as typeof fetch })

    await expect(downloader.download(file)).rejects.toThrow('unsafe backup download location')
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('rejects backups above the configured size limit before contacting Graph', async () => {
    const request = vi.fn()
    const downloader = new OneDriveMoonBackupDownloader({
      tokenProvider,
      fetch: request as typeof fetch,
      maxDownloadBytes: 2
    })

    await expect(downloader.download(file)).rejects.toThrow('configured download size limit')
    expect(request).not.toHaveBeenCalled()
  })

  it('rejects an oversized response even when the listed size was missing', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { Location: 'https://download.example/file' }
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }))
    const downloader = new OneDriveMoonBackupDownloader({
      tokenProvider,
      fetch: request as typeof fetch,
      maxDownloadBytes: 2
    })

    await expect(downloader.download({ ...file, size: null })).rejects.toThrow('configured download size limit')
  })

  it('accepts only .mrpro files', async () => {
    const request = vi.fn()
    const downloader = new OneDriveMoonBackupDownloader({ tokenProvider, fetch: request as typeof fetch })

    await expect(downloader.download({ ...file, name: 'notes.txt' })).rejects.toThrow('Only a listed .mrpro backup')
    expect(request).not.toHaveBeenCalled()
  })
})
