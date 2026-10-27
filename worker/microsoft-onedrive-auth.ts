import type { D1Database } from './cloudflare-types'
import type { GraphAccessTokenProvider } from './onedrive-moon-backup-source'

const tokenEndpoint = (tenant: string): string => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`
const authorizeEndpoint = (tenant: string): string => `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize`
const redirectCookie = 'readingcenter_ms_oauth'
const credentialId = 'microsoft-onedrive-refresh-token'
const oauthScopes = ['offline_access', 'Files.Read'] as const
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export interface MicrosoftOneDriveAuthConfig {
  clientId?: string
  clientSecret?: string
  tenantId?: string
  redirectUri?: string
  tokenEncryptionKey?: string
  sessionSecret?: string
  fetch?: typeof globalThis.fetch
}

interface StoredCredential { encrypted_value: string }
interface OAuthTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  error?: string
}

interface OAuthState {
  state: string
  verifier: string
  expiresAt: number
}

/** Starts Microsoft delegated Files.Read consent with PKCE and a signed, short-lived state cookie. */
export async function handleMicrosoftOneDriveConnect(
  config: MicrosoftOneDriveAuthConfig,
  now = Date.now()
): Promise<Response> {
  const ready = validateConfig(config)
  if (!ready.ok) return jsonError(503, 'onedrive_not_configured', ready.message)
  const state = randomToken(32)
  const verifier = randomToken(48)
  const challenge = base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(verifier))))
  const signedState = await signState({ state, verifier, expiresAt: now + 10 * 60 * 1000 }, ready.sessionSecret)
  const authorization = new URL(authorizeEndpoint(ready.tenantId))
  authorization.search = new URLSearchParams({
    client_id: ready.clientId,
    response_type: 'code',
    redirect_uri: ready.redirectUri,
    response_mode: 'query',
    scope: oauthScopes.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'consent'
  }).toString()
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorization.toString(),
      'Cache-Control': 'no-store',
      'Set-Cookie': `${redirectCookie}=${signedState}; Path=/api/v1/onedrive; Max-Age=600; HttpOnly; Secure; SameSite=Lax`
    }
  })
}

/** Exchanges the one-time authorization code and stores only an encrypted refresh token in D1. */
export async function handleMicrosoftOneDriveCallback(
  request: Request,
  database: D1Database,
  config: MicrosoftOneDriveAuthConfig,
  now = Date.now()
): Promise<Response> {
  const ready = validateConfig(config)
  if (!ready.ok) return jsonError(503, 'onedrive_not_configured', ready.message)
  const url = new URL(request.url)
  const error = url.searchParams.get('error')
  if (error) return clearOAuthCookie(jsonError(400, 'onedrive_consent_failed', 'Microsoft authorization was not completed'))
  const code = url.searchParams.get('code')
  const requestedState = url.searchParams.get('state')
  const cookie = readCookie(request.headers.get('Cookie'), redirectCookie)
  const state = cookie ? await verifyState(cookie, ready.sessionSecret, now) : null
  if (!code || !requestedState || !state || state.state !== requestedState) {
    return clearOAuthCookie(jsonError(400, 'invalid_oauth_state', 'Microsoft authorization could not be verified'))
  }

  const response = await (config.fetch ?? globalThis.fetch)(tokenEndpoint(ready.tenantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ready.clientId,
      client_secret: ready.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: ready.redirectUri,
      code_verifier: state.verifier,
      scope: oauthScopes.join(' ')
    })
  })
  const token = await readTokenResponse(response)
  if (!response.ok || !token.refresh_token) {
    return clearOAuthCookie(jsonError(502, 'onedrive_token_exchange_failed', 'Microsoft sign-in did not return a refresh token'))
  }
  await saveRefreshToken(database, token.refresh_token, ready.tokenEncryptionKey, now)
  return clearOAuthCookie(Response.redirect(new URL('/?onedrive=connected', url.origin), 303))
}

/** Exchanges the stored refresh token whenever the Worker needs a short-lived Graph access token. */
export class MicrosoftOneDriveTokenProvider implements GraphAccessTokenProvider {
  private cachedToken: { value: string; expiresAt: number } | undefined

  constructor(
    private readonly database: D1Database,
    private readonly config: MicrosoftOneDriveAuthConfig,
    private readonly now: () => number = Date.now
  ) {}

  async getAccessToken(scopes: readonly string[]): Promise<string> {
    if (!scopes.includes('Files.Read')) throw new Error('Only the approved Files.Read scope is available')
    const ready = validateConfig(this.config)
    if (!ready.ok) throw new Error(ready.message)
    const now = this.now()
    if (this.cachedToken && this.cachedToken.expiresAt > now + 60_000) return this.cachedToken.value

    const row = await this.database.prepare(
      'SELECT encrypted_value FROM integration_tokens WHERE credential_id = ?'
    ).bind(credentialId).first<StoredCredential>()
    if (!row?.encrypted_value) throw new Error('Microsoft sign-in is required once to connect OneDrive')
    const refreshToken = await decrypt(row.encrypted_value, ready.tokenEncryptionKey)
    const response = await (this.config.fetch ?? globalThis.fetch)(tokenEndpoint(ready.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: ready.clientId,
        client_secret: ready.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        redirect_uri: ready.redirectUri,
        scope: oauthScopes.join(' ')
      })
    })
    const token = await readTokenResponse(response)
    if (!response.ok || !token.access_token) {
      if (token.error === 'invalid_grant') throw new Error('Microsoft sign-in expired; reconnect OneDrive once')
      throw new Error('Microsoft could not refresh the OneDrive connection')
    }
    if (token.refresh_token && token.refresh_token !== refreshToken) {
      await saveRefreshToken(this.database, token.refresh_token, ready.tokenEncryptionKey, now)
    }
    const lifetime = Math.max(60, token.expires_in ?? 3600) * 1000
    this.cachedToken = { value: token.access_token, expiresAt: now + lifetime }
    return token.access_token
  }
}

async function saveRefreshToken(database: D1Database, refreshToken: string, secret: string, now: number): Promise<void> {
  const encrypted = await encrypt(refreshToken, secret)
  const updatedAt = new Date(now).toISOString()
  await database.prepare(
    'INSERT INTO integration_tokens (credential_id, encrypted_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(credential_id) DO UPDATE SET encrypted_value = excluded.encrypted_value, updated_at = excluded.updated_at'
  ).bind(credentialId, encrypted, updatedAt).run()
}

async function encrypt(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await encryptionKey(secret)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: exactBuffer(iv) }, key, encoder.encode(value))
  return base64Url(iv) + '.' + base64Url(new Uint8Array(ciphertext))
}

async function decrypt(value: string, secret: string): Promise<string> {
  const [encodedIv, encodedCiphertext] = value.split('.')
  if (!encodedIv || !encodedCiphertext) throw new Error('Stored Microsoft credential is invalid')
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: exactBuffer(fromBase64Url(encodedIv)) },
      await encryptionKey(secret),
      exactBuffer(fromBase64Url(encodedCiphertext))
    )
    return decoder.decode(plaintext)
  } catch {
    throw new Error('Stored Microsoft credential could not be decrypted')
  }
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

async function readTokenResponse(response: Response): Promise<OAuthTokenResponse> {
  try { return await response.json() as OAuthTokenResponse } catch { return {} }
}

async function signState(state: OAuthState, secret: string): Promise<string> {
  const payload = base64Url(encoder.encode(JSON.stringify(state)))
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return payload + '.' + base64Url(new Uint8Array(signature))
}

async function verifyState(value: string, secret: string, now: number): Promise<OAuthState | null> {
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify('HMAC', key, exactBuffer(fromBase64Url(signature)), encoder.encode(payload))
    if (!valid) return null
    const state = JSON.parse(decoder.decode(fromBase64Url(payload))) as OAuthState
    if (!state.state || !state.verifier || !Number.isFinite(state.expiresAt) || state.expiresAt < now) return null
    return state
  } catch { return null }
}

function validateConfig(config: MicrosoftOneDriveAuthConfig):
  | { ok: true; clientId: string; clientSecret: string; tenantId: string; redirectUri: string; tokenEncryptionKey: string; sessionSecret: string }
  | { ok: false; message: string } {
  const { clientId, clientSecret, redirectUri, tokenEncryptionKey, sessionSecret } = config
  if (!clientId || !clientSecret || !redirectUri || !tokenEncryptionKey || tokenEncryptionKey.length < 32 || !sessionSecret || sessionSecret.length < 32) {
    return { ok: false, message: 'Microsoft OneDrive OAuth secrets are not configured' }
  }
  let callback: URL
  try { callback = new URL(redirectUri) } catch { return { ok: false, message: 'Microsoft redirect URL is invalid' } }
  if (callback.protocol !== 'https:' || callback.username || callback.password ||
    callback.pathname !== '/api/v1/onedrive/callback' || callback.search || callback.hash) {
    return { ok: false, message: 'Microsoft redirect URL must be the HTTPS OneDrive callback route' }
  }
  return { ok: true, clientId, clientSecret, tenantId: config.tenantId || 'common', redirectUri, tokenEncryptionKey, sessionSecret }
}

function randomToken(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return base64Url(bytes)
}

function base64Url(value: Uint8Array): string {
  let binary = ''
  for (const byte of value) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}

function readCookie(header: string | null, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

function clearOAuthCookie(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.append('Set-Cookie', `${redirectCookie}=; Path=/api/v1/onedrive; Max-Age=0; HttpOnly; Secure; SameSite=Lax`)
  headers.set('Cache-Control', 'no-store')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })
}
