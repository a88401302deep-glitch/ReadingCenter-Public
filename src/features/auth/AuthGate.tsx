import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../../shared/ui/Button'
import { Icon } from '../../shared/ui/Icon'
import { AuthContext, type AuthContextValue } from './auth-context'

import { acknowledgeLogout, clearOfflineAccess, grantOfflineAccess, isAuthStorageKey, markLogout, offlineExpiresAt, pendingLogout, unlockOfflineAccess } from './offline-access'

type AuthStatus = 'checking' | 'disabled' | 'signed-out' | 'signed-in' | 'offline-locked' | 'offline' | 'error'

interface AuthGateProps {
  children: ReactNode
  forceAuthentication?: boolean
}

export function AuthGate({ children, forceAuthentication = false }: AuthGateProps) {
  const [status, setStatus] = useState<AuthStatus>(() => import.meta.env.DEV && !forceAuthentication ? 'disabled' : 'checking')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [previewReadOnly, setPreviewReadOnly] = useState(false)
  const [remoteVerified, setRemoteVerified] = useState(false)
  const [allowOffline, setAllowOffline] = useState(false)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const generation = useRef(0)
  const currentStatus = useRef(status)
  useEffect(() => { currentStatus.current = status }, [status])

  useEffect(() => {
    if (import.meta.env.DEV && !forceAuthentication) return
    let controller: AbortController | null = null
    const check = async () => {
      setRemoteVerified(false)
      controller?.abort()
      controller = new AbortController()
      const attempt = ++generation.current
      const valid = () => attempt === generation.current && !controller?.signal.aborted
      let receivedResponse = false
      try {
        if (pendingLogout()) {
          const response = await fetch('/api/v1/auth/logout', { method: 'POST', signal: controller.signal })
          if (!valid()) return
          if (!response.ok) throw new Error('Logout unavailable')
          acknowledgeLogout()
          setStatus('signed-out')
          return
        }
        const response = await fetch('/api/v1/auth/session', { signal: controller.signal })
        receivedResponse = true
        if (!valid()) return
        if (response.ok) {
          const body = await response.json() as { data?: { authenticated?: boolean; expiresAt?: string; previewReadOnly?: boolean } }
          if (!valid()) return
          if (typeof body.data?.authenticated !== 'boolean') throw new Error('Invalid session response')
          setPreviewReadOnly(body.data.previewReadOnly === true)
          if (body.data.authenticated) {
            setExpiresAt(readExpiry(body.data.expiresAt))
            setRemoteVerified(true); setStatus('signed-in')
          } else {
            clearOfflineAccess(); setExpiresAt(null); setStatus('signed-out')
          }
        } else if (response.status === 401) {
          clearOfflineAccess(); setExpiresAt(null); setStatus('signed-out')
        } else {
          const code = await readErrorCode(response)
          if (valid()) setStatus(response.status === 503 && code === 'auth_not_configured' ? 'disabled' : 'error')
        }
      } catch {
        if (!valid()) return
        // A failed protocol response while online never grants offline access.
        const expiry = offlineExpiresAt()
        if (!receivedResponse && navigator.onLine === false && expiry) {
          setExpiresAt(expiry)
          setStatus(currentStatus.current === 'offline' || currentStatus.current === 'signed-in' ? 'offline' : 'offline-locked')
        } else setStatus('error')
      }
    }
    const online = () => { void check() }
    const focus = () => { if (navigator.onLine && ['signed-in', 'offline', 'error', 'offline-locked'].includes(currentStatus.current)) void check() }
    const offline = () => {
      generation.current += 1; controller?.abort()
      const expiry = offlineExpiresAt()
      setExpiresAt(expiry)
      if (currentStatus.current === 'signed-in' || currentStatus.current === 'offline') setStatus(expiry ? 'offline' : 'error')
      else if (currentStatus.current !== 'signed-out') setStatus(expiry ? 'offline-locked' : 'error')
    }
    const revoke = () => {
      generation.current += 1; controller?.abort()
      setExpiresAt(null); setStatus('signed-out')
      clearOfflineAccess()
    }
    const storage = (event: StorageEvent) => {
      if (isAuthStorageKey(event.key) && (pendingLogout() || !offlineExpiresAt())) revoke()
    }
    void check()
    window.addEventListener('online', online)
    window.addEventListener('offline', offline)
    window.addEventListener('focus', focus)
    window.addEventListener('readingcenter-auth-required', revoke)
    window.addEventListener('storage', storage)
    return () => {
      generation.current += 1; controller?.abort()
      window.removeEventListener('online', online)
      window.removeEventListener('offline', offline)
      window.removeEventListener('focus', focus)
      window.removeEventListener('readingcenter-auth-required', revoke)
      window.removeEventListener('storage', storage)
    }
  }, [forceAuthentication])

  useEffect(() => {
    if (!expiresAt || !['signed-in', 'offline', 'offline-locked'].includes(status)) return
    let timer: number
    const expire = () => {
      const remaining = expiresAt - Date.now()
      if (remaining > 0) {
        timer = window.setTimeout(expire, Math.min(remaining, 2_147_483_647))
        return
      }
      generation.current += 1
      setStatus('signed-out'); setMessage('存取期限已到，請連線重新登入')
      clearOfflineAccess()
    }
    timer = window.setTimeout(expire, Math.max(0, Math.min(expiresAt - Date.now(), 2_147_483_647)))
    return () => window.clearTimeout(timer)
  }, [expiresAt, status])

  const login = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const attempt = ++generation.current
    try {
      if (status === 'offline-locked') {
        const unlocked = await unlockOfflineAccess(password)
        if (attempt !== generation.current) return
        if (!unlocked) { setMessage('密碼不正確或離線存取已到期'); return }
        setPassword(''); setExpiresAt(offlineExpiresAt()); setStatus('offline'); return
      }
      if (pendingLogout()) {
        const revoked = await fetch('/api/v1/auth/logout', { method: 'POST' })
        if (attempt !== generation.current) return
        if (!revoked.ok) throw new Error('Logout unavailable')
        acknowledgeLogout()
      }
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      })
      if (attempt !== generation.current) return
      if (response.ok) {
        const body = await response.json() as { data?: { authenticated?: boolean; expiresAt?: string; previewReadOnly?: boolean } }
        if (attempt !== generation.current) return
        if (body.data?.authenticated !== true) throw new Error('Invalid login response')
        setPreviewReadOnly(body.data.previewReadOnly === true)
        if (allowOffline && body.data.expiresAt) {
          try { await grantOfflineAccess(password, body.data.expiresAt, Date.now(), () => attempt === generation.current) }
          catch {
            if (attempt !== generation.current) return
            clearOfflineAccess(); setMessage('已登入，但此裝置無法保存離線存取授權')
          }
        } else clearOfflineAccess()
        if (attempt !== generation.current) return
        setExpiresAt(readExpiry(body.data.expiresAt))
        setPassword('')
        setRemoteVerified(true); setStatus('signed-in')
      } else {
        setMessage(loginMessage(await readErrorCode(response)))
      }
    } catch {
      if (attempt === generation.current) setMessage('目前無法登入')
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    generation.current += 1
    setStatus('signed-out'); setPassword(''); setExpiresAt(null)
    try { markLogout() } catch { setMessage('此裝置無法保存登出狀態，請連線完成登出') }
    try {
      const response = await fetch('/api/v1/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('Logout unavailable')
      acknowledgeLogout()
    } catch { setMessage('已退出此裝置；重新連線後將完成伺服器登出') }
  }

  const context = useMemo<AuthContextValue>(() => ({ previewReadOnly, authEnabled: status === 'signed-in' && remoteVerified, localAccess: status === 'signed-in' || status === 'offline', logout }), [status, remoteVerified, previewReadOnly])

  if (status === 'disabled') return <>{children}</>
  if (status === 'signed-in' || status === 'offline') return <AuthContext.Provider value={context}>{message && <p role="status">{message}</p>}{children}</AuthContext.Provider>

  return <main className="auth-page">
    <section className="auth-panel" aria-busy={status === 'checking'}>
      <div className="auth-brand-mark"><Icon name="book" size={24} /></div>
      <p className="auth-kicker">ReadingCenter</p>
      <h1>閱讀中心</h1>
      {status === 'checking' && <p className="auth-status" role="status">載入中</p>}
      {status === 'error' && <><p className="form-message form-message--error" role="alert">目前無法連線</p><Button onClick={() => window.location.reload()}>重新整理</Button></>}
      {(status === 'signed-out' || status === 'offline-locked') && <form className="auth-form" onSubmit={(event) => void login(event)}>
        {status === 'offline-locked' && <p>目前離線，輸入密碼開啟此裝置副本；修改將保留，連線驗證成功後才同步。</p>}
        <label htmlFor="readingcenter-password">密碼</label>
        <input autoComplete="current-password" autoFocus id="readingcenter-password" maxLength={256} onChange={(event) => setPassword(event.target.value)} required type="password" value={password} />
        {status === 'signed-out' && <label><input type="checkbox" checked={allowOffline} onChange={(event) => setAllowOffline(event.target.checked)} />允許此裝置離線使用（最多 7 天，離線重開仍需密碼）</label>}
        {message && <p className="form-message form-message--error" role="alert">{message}</p>}
        <Button disabled={busy || password.length === 0} type="submit" variant="primary">{busy ? '驗證中' : status === 'offline-locked' ? '開啟離線副本' : '登入'}</Button>
      </form>}
    </section>
  </main>
}

async function readErrorCode(response: Response): Promise<string | undefined> {
  try {
    const body = await response.json() as { error?: { code?: string } }
    return body.error?.code
  } catch {
    return undefined
  }
}

function loginMessage(code: string | undefined): string {
  if (code === 'invalid_credentials') return '密碼不正確'
  if (code === 'too_many_attempts') return '嘗試次數過多，請稍後再試'
  return '目前無法登入'
}

function readExpiry(value: string | undefined): number | null {
  const expiry = value ? Date.parse(value) : NaN
  return Number.isFinite(expiry) ? expiry : null
}
