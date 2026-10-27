const sessionCookieName = 'readingcenter_session'
const defaultSessionSeconds = 60 * 60 * 24 * 30
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface AuthConfig {
  password: string
  sessionSecret: string
  sessionDurationSeconds?: number
}

export interface LoginRateLimiter {
  check(clientKey: string, now: number): Promise<{ allowed: boolean; retryAfterSeconds: number }>
  recordFailure(clientKey: string, now: number): Promise<void>
  reset(clientKey: string): Promise<void>
}

interface SessionPayload {
  version: 1
  expiresAt: number
}

export async function handleAuthApi(
  request: Request,
  config: AuthConfig | undefined,
  now = Date.now(),
  rateLimiter?: LoginRateLimiter
): Promise<Response> {
  const pathname = new URL(request.url).pathname

  if (pathname === '/api/v1/auth/login' && request.method === 'POST') {
    if (!isValidConfig(config)) return authError(503, 'auth_not_configured', 'Authentication is not configured')
    const clientKey = rateLimiter ? await createClientKey(request, config.sessionSecret) : undefined
    if (rateLimiter && clientKey) {
      try {
        const state = await rateLimiter.check(clientKey, now)
        if (!state.allowed) {
          return authError(429, 'too_many_attempts', 'Too many sign-in attempts; try again later', {
            'Retry-After': String(state.retryAfterSeconds)
          })
        }
      } catch {
        return authError(503, 'auth_unavailable', 'Authentication is temporarily unavailable')
      }
    }
    const password = await readPassword(request)
    if (password === undefined || !(await secureTextEquals(password, config.password))) {
      if (rateLimiter && clientKey) {
        try {
          await rateLimiter.recordFailure(clientKey, now)
        } catch {
          return authError(503, 'auth_unavailable', 'Authentication is temporarily unavailable')
        }
      }
      return authError(401, 'invalid_credentials', 'Unable to sign in')
    }

    if (rateLimiter && clientKey) {
      try {
        await rateLimiter.reset(clientKey)
      } catch {
        return authError(503, 'auth_unavailable', 'Authentication is temporarily unavailable')
      }
    }

    const duration = readSessionDuration(config)
    const token = await createSessionToken(config.sessionSecret, now + duration * 1000)
    return authJson(
      { data: { authenticated: true, expiresAt: new Date(now + duration * 1000).toISOString() } },
      200,
      { 'Set-Cookie': createSessionCookie(token, duration) }
    )
  }

  if (pathname === '/api/v1/auth/session' && request.method === 'GET') {
    if (!isValidConfig(config)) return authError(503, 'auth_not_configured', 'Authentication is not configured')
    const session = await readValidSession(request, config.sessionSecret, now)
    return authJson({ data: { authenticated: session !== null, ...(session ? { expiresAt: new Date(session.expiresAt).toISOString() } : {}) } })
  }

  if (pathname === '/api/v1/auth/logout' && request.method === 'POST') {
    return authJson(
      { data: { authenticated: false } },
      200,
      { 'Set-Cookie': clearSessionCookie() }
    )
  }

  return authError(404, 'not_found', 'Authentication route not found')
}

async function createClientKey(request: Request, secret: string): Promise<string> {
  const address = request.headers.get('CF-Connecting-IP') ?? 'unknown-client'
  return encodeBase64Url(await sign(address, secret))
}

export async function hasValidSession(request: Request, sessionSecret: string, now = Date.now()): Promise<boolean> {
  return (await readValidSession(request, sessionSecret, now)) !== null
}

async function readValidSession(request: Request, sessionSecret: string, now: number): Promise<SessionPayload | null> {
  if (sessionSecret.length < 32) return null
  const token = readCookie(request.headers.get('Cookie'), sessionCookieName)
  return token ? verifySessionToken(token, sessionSecret, now) : null
}

function isValidConfig(config: AuthConfig | undefined): config is AuthConfig {
  return Boolean(config && config.password.length >= 12 && config.sessionSecret.length >= 32)
}

function readSessionDuration(config: AuthConfig): number {
  const duration = config.sessionDurationSeconds ?? defaultSessionSeconds
  return Number.isInteger(duration) && duration >= 300 && duration <= defaultSessionSeconds
    ? duration
    : defaultSessionSeconds
}

async function readPassword(request: Request): Promise<string | undefined> {
  const contentLength = Number(request.headers.get('Content-Length') ?? 0)
  if (contentLength > 4096) return undefined

  try {
    const value: unknown = await request.json()
    if (!isRecord(value) || typeof value.password !== 'string') return undefined
    if (value.password.length < 1 || value.password.length > 256) return undefined
    return value.password
  } catch {
    return undefined
  }
}

async function createSessionToken(secret: string, expiresAt: number): Promise<string> {
  const payload: SessionPayload = { version: 1, expiresAt }
  const encodedPayload = encodeBase64Url(encoder.encode(JSON.stringify(payload)))
  const signature = await sign(encodedPayload, secret)
  return `${encodedPayload}.${encodeBase64Url(signature)}`
}

async function verifySessionToken(token: string, secret: string, now: number): Promise<SessionPayload | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null

  try {
    const expectedSignature = await sign(parts[0], secret)
    const receivedSignature = decodeBase64Url(parts[1])
    if (!secureBytesEqual(expectedSignature, receivedSignature)) return null

    const value: unknown = JSON.parse(decoder.decode(decodeBase64Url(parts[0])))
    return isRecord(value) && value.version === 1 && typeof value.expiresAt === 'number'
      && Number.isFinite(value.expiresAt) && value.expiresAt > now ? { version: 1, expiresAt: value.expiresAt } : null
  } catch {
    return null
  }
}

async function sign(value: string, secret: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)))
}

async function secureTextEquals(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(left)),
    crypto.subtle.digest('SHA-256', encoder.encode(right))
  ])
  return secureBytesEqual(new Uint8Array(leftDigest), new Uint8Array(rightDigest))
}

function secureBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]
  return difference === 0
}

function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return part.slice(separator + 1).trim()
  }
  return undefined
}

function createSessionCookie(token: string, maxAge: number): string {
  return `${sessionCookieName}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`
}

function clearSessionCookie(): string {
  return `${sessionCookieName}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padding = '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(normalized + padding)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function authError(status: number, code: string, message: string, headers: HeadersInit = {}): Response {
  return authJson({ error: { code, message } }, status, headers)
}

function authJson(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...headers
    }
  })
}
