// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { useAuth } from '../../src/features/auth/auth-context'
import { grantOfflineAccess, pendingLogout } from '../../src/features/auth/offline-access'
import { AuthGate } from '../../src/features/auth/AuthGate'

beforeEach(() => { localStorage.clear(); vi.stubGlobal('crypto', webcrypto) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

function PrivateApp() {
  const { authEnabled, localAccess, logout } = useAuth()
  return <><p>私人書庫</p><p>{authEnabled ? '遠端已驗證' : localAccess ? '僅本機存取' : '未授權'}</p><button onClick={() => void logout()}>登出</button></>
}

describe('authentication gate', () => {
  it('shows the password form when authentication is configured', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { authenticated: false } })))
    render(<AuthGate forceAuthentication><div>私人書庫</div></AuthGate>)
    expect(await screen.findByRole('heading', { name: '閱讀中心' })).not.toBeNull()
    expect(screen.getByLabelText('密碼')).not.toBeNull()
    expect(screen.queryByText('私人書庫')).toBeNull()
  })

  it('opens the app after a successful sign-in', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: { authenticated: false } }))
      .mockResolvedValueOnce(Response.json({ data: { authenticated: true } }))
    vi.stubGlobal('fetch', fetchMock)
    render(<AuthGate forceAuthentication><div>私人書庫</div></AuthGate>)
    fireEvent.change(await screen.findByLabelText('密碼'), { target: { value: 'personal-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登入' }))
    await waitFor(() => expect(screen.getByText('私人書庫')).not.toBeNull())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/v1/auth/login', expect.objectContaining({ method: 'POST' }))
  })
  it('unlocks only a previously authorized device while offline and revalidates before remote access', async () => {
    await grantOfflineAccess('synthetic-password', new Date(Date.now() + 60_000).toISOString())
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const fetcher = vi.fn().mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetcher)
    render(<AuthGate forceAuthentication><PrivateApp /></AuthGate>)
    await screen.findByRole('button', { name: '開啟離線副本' })
    expect(screen.queryByText('私人書庫')).toBeNull()
    fireEvent.change(screen.getByLabelText('密碼'), { target: { value: 'synthetic-password' } })
    fireEvent.click(screen.getByRole('button', { name: '開啟離線副本' }))
    await screen.findByText('僅本機存取')
    online.mockReturnValue(true)
    fetcher.mockResolvedValue(Response.json({ data: { authenticated: true, expiresAt: new Date(Date.now() + 60_000).toISOString() } }))
    fireEvent(window, new Event('online'))
    await screen.findByText('遠端已驗證')
    fireEvent(window, new Event('readingcenter-auth-required'))
    await screen.findByLabelText('密碼')
    expect(screen.queryByText('私人書庫')).toBeNull()
  })

  it('locks immediately on failed offline logout and revokes the cookie before any later session check', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: { authenticated: true } }))
      .mockRejectedValue(new TypeError('offline'))
    vi.stubGlobal('fetch', fetcher)
    const mounted = render(<AuthGate forceAuthentication><PrivateApp /></AuthGate>)
    fireEvent.click(await screen.findByRole('button', { name: '登出' }))
    await screen.findByText('已退出此裝置；重新連線後將完成伺服器登出')
    expect(screen.queryByText('私人書庫')).toBeNull()
    expect(pendingLogout()).toBe(true)
    mounted.unmount()
    fetcher.mockClear().mockResolvedValue(Response.json({ data: { authenticated: false } }))
    render(<AuthGate forceAuthentication><PrivateApp /></AuthGate>)
    await screen.findByLabelText('密碼')
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/logout'])
    expect(pendingLogout()).toBe(false)
  })

  it('does not expose data on malformed session responses or unregistered offline devices', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    const mounted = render(<AuthGate forceAuthentication><PrivateApp /></AuthGate>)
    await screen.findByText('目前無法連線')
    expect(screen.queryByText('私人書庫')).toBeNull()
    mounted.unmount()
    await grantOfflineAccess('synthetic-password', new Date(Date.now() + 60_000).toISOString())
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>fallback</html>')))
    render(<AuthGate forceAuthentication><PrivateApp /></AuthGate>)
    await screen.findByText('目前無法連線')
    expect(screen.queryByRole('button', { name: '開啟離線副本' })).toBeNull()
    expect(screen.queryByText('私人書庫')).toBeNull()
  })

  it('keeps a long session open across the timer limit and locks at its actual expiry', async () => {
    const expiresAt = Date.now() + 30 * 24 * 60 * 60 * 1000
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { authenticated: true, expiresAt: new Date(expiresAt).toISOString() } })))
    render(<AuthGate forceAuthentication><PrivateApp /></AuthGate>)
    await screen.findByText('遠端已驗證')
    vi.useFakeTimers()
    try {
      // Trigger a new session check so the expiry effect schedules under the fake clock.
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: { authenticated: true, expiresAt: new Date(expiresAt + 1).toISOString() } })))
      await act(async () => { fireEvent(window, new Event('online')) })
      await act(async () => { await vi.advanceTimersByTimeAsync(2_147_483_647) })
      expect(screen.getByText('私人書庫')).not.toBeNull()
      await act(async () => { await vi.advanceTimersByTimeAsync(30 * 24 * 60 * 60 * 1000 - 2_147_483_647 + 1) })
      expect(screen.queryByText('私人書庫')).toBeNull()
      expect(screen.getByText('存取期限已到，請連線重新登入')).not.toBeNull()
    } finally { vi.useRealTimers() }
  })

  it('suspends remote access during a session recheck without closing the local copy', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: { authenticated: true } }))
    vi.stubGlobal('fetch', fetcher)
    render(<AuthGate forceAuthentication><PrivateApp /></AuthGate>)
    await screen.findByText('遠端已驗證')
    let resolve!: (response: Response) => void
    fetcher.mockImplementation(() => new Promise<Response>((done) => { resolve = done }))
    fireEvent(window, new Event('online'))
    expect(screen.getByText('僅本機存取')).not.toBeNull()
    expect(screen.getByText('私人書庫')).not.toBeNull()
    await act(async () => { resolve(Response.json({ data: { authenticated: false } })) })
    expect(screen.queryByText('私人書庫')).toBeNull()
    expect(screen.getByLabelText('密碼')).not.toBeNull()
  })

})
