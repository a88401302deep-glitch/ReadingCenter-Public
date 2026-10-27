import { describe, expect, it } from 'vitest'
import {
  handleAuthApi,
  hasValidSession,
  type AuthConfig,
  type LoginRateLimiter
} from '../../src/server/auth'

const now = Date.parse('2026-09-15T00:00:00.000Z')
const config: AuthConfig = {
  password: 'a-long-personal-password',
  sessionSecret: 'a-session-signing-secret-that-is-at-least-32-characters',
  sessionDurationSeconds: 3600
}

describe('personal password authentication', () => {
  it('signs in with an HttpOnly secure cookie and validates the session', async () => {
    const login = await call('/api/v1/auth/login', 'POST', { password: config.password })
    const body = await login.json()
    const cookie = login.headers.get('Set-Cookie')

    expect(login.status).toBe(200)
    expect(body.data.authenticated).toBe(true)
    expect(cookie).toContain('readingcenter_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Strict')

    const sessionCookie = cookie?.split(';')[0] ?? ''
    const request = new Request('https://reading.example/api/v1/entities/book', {
      headers: { Cookie: sessionCookie }
    })
    expect(await hasValidSession(request, config.sessionSecret, now + 1000)).toBe(true)
  })

  it('rejects invalid credentials without revealing which value failed', async () => {
    const response = await call('/api/v1/auth/login', 'POST', { password: 'wrong-password' })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({
      error: { code: 'invalid_credentials', message: 'Unable to sign in' }
    })
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('rejects tampered and expired session tokens', async () => {
    const login = await call('/api/v1/auth/login', 'POST', { password: config.password })
    const sessionCookie = login.headers.get('Set-Cookie')?.split(';')[0] ?? ''
    const token = sessionCookie.slice(sessionCookie.indexOf('=') + 1)

    const tampered = new Request('https://reading.example/api/v1/entities/book', {
      headers: { Cookie: `readingcenter_session=${token}changed` }
    })
    expect(await hasValidSession(tampered, config.sessionSecret, now + 1000)).toBe(false)

    const expired = new Request('https://reading.example/api/v1/entities/book', {
      headers: { Cookie: sessionCookie }
    })
    expect(await hasValidSession(expired, config.sessionSecret, now + 3600 * 1000)).toBe(false)
  })

  it('clears the browser session on logout', async () => {
    const response = await call('/api/v1/auth/logout', 'POST')
    expect(response.status).toBe(200)
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })

  it('keeps authentication unavailable until Cloudflare secrets are configured', async () => {
    const response = await handleAuthApi(
      new Request('https://reading.example/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ password: config.password })
      }),
      undefined,
      now
    )
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('auth_not_configured')
  })

  it('temporarily blocks repeated failed sign-in attempts', async () => {
    const limiter = new TestRateLimiter(2)

    expect((await call('/api/v1/auth/login', 'POST', { password: 'wrong-password' }, limiter)).status).toBe(401)
    expect((await call('/api/v1/auth/login', 'POST', { password: 'wrong-password' }, limiter)).status).toBe(401)

    const blocked = await call('/api/v1/auth/login', 'POST', { password: config.password }, limiter)
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('900')
    expect((await blocked.json()).error.code).toBe('too_many_attempts')
  })

  it('clears failed-attempt history after a successful sign-in', async () => {
    const limiter = new TestRateLimiter(5)
    await call('/api/v1/auth/login', 'POST', { password: 'wrong-password' }, limiter)

    const login = await call('/api/v1/auth/login', 'POST', { password: config.password }, limiter)
    expect(login.status).toBe(200)
    expect(limiter.failures).toBe(0)
  })
  it('reports only the verified cookie expiry and does not extend it on session checks', async () => {
    const login = await call('/api/v1/auth/login', 'POST', { password: config.password })
    const cookie = login.headers.get('Set-Cookie')!.split(';')[0]
    const request = new Request('https://reading.example/api/v1/auth/session', { headers: { Cookie: cookie } })
    const response = await handleAuthApi(request, config, now + 1000)
    expect(await response.json()).toEqual({ data: { authenticated: true, expiresAt: new Date(now + 3600_000).toISOString() } })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const expired = await handleAuthApi(request, config, now + 3600_000)
    expect(await expired.json()).toEqual({ data: { authenticated: false } })
  })

})

async function call(
  path: string,
  method: string,
  body?: unknown,
  rateLimiter?: LoginRateLimiter
): Promise<Response> {
  return handleAuthApi(
    new Request(`https://reading.example${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.1' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }),
    config,
    now,
    rateLimiter
  )
}

class TestRateLimiter implements LoginRateLimiter {
  failures = 0

  constructor(private readonly maximumAttempts: number) {}

  async check(): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    return { allowed: this.failures < this.maximumAttempts, retryAfterSeconds: 900 }
  }

  async recordFailure(): Promise<void> {
    this.failures += 1
  }

  async reset(): Promise<void> {
    this.failures = 0
  }
}
