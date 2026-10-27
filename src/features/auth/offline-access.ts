const accessKey = 'readingcenter.offline-access.v1'
const logoutKey = 'readingcenter.pending-logout.v1'
const maxAge = 7 * 24 * 60 * 60 * 1000
const iterations = 600_000

interface OfflineAccess {
  version: 1
  grantedAt: number
  expiresAt: number
  lastSeenAt: number
  salt: number[]
  verifier: number[]
}

export function pendingLogout(): boolean {
  try { return localStorage.getItem(logoutKey) !== null } catch { return true }
}

export function markLogout(): void {
  try { localStorage.setItem(logoutKey, 'pending') } finally { clearOfflineAccess() }
}

export function acknowledgeLogout(): void { localStorage.removeItem(logoutKey) }
export function clearOfflineAccess(): void { localStorage.removeItem(accessKey) }

function readAccess(now = Date.now()): OfflineAccess | null {
  try {
    const raw = localStorage.getItem(accessKey)
    if (!raw || pendingLogout()) return null
    const value = JSON.parse(raw) as OfflineAccess
    const bytes = (data: unknown, length: number): data is number[] => Array.isArray(data)
      && data.length === length && data.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
    if (value.version !== 1 || !Number.isFinite(value.grantedAt) || !Number.isFinite(value.expiresAt)
      || !Number.isFinite(value.lastSeenAt) || value.grantedAt > now || value.expiresAt <= now
      || value.expiresAt <= value.grantedAt || value.expiresAt - value.grantedAt > maxAge
      || value.lastSeenAt < value.grantedAt || value.lastSeenAt > now + 60_000
      || !bytes(value.salt, 16) || !bytes(value.verifier, 32)) return null
    return value
  } catch { return null }
}

export function offlineExpiresAt(): number | null { return readAccess()?.expiresAt ?? null }

async function derive(password: string, salt: number[]): Promise<number[]> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(salt), iterations, hash: 'SHA-256' }, key, 256)
  return Array.from(new Uint8Array(bits))
}

// This grants access to an existing local copy only; it never authenticates an API request.
export async function grantOfflineAccess(password: string, sessionExpiresAt: string, now = Date.now(), canSave = () => true): Promise<void> {
  const expiresAt = Math.min(Date.parse(sessionExpiresAt), now + maxAge)
  if (!Number.isFinite(expiresAt) || expiresAt <= now || pendingLogout()) throw new Error('無法建立離線存取授權')
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
  const verifier = await derive(password, salt)
  if (pendingLogout() || !canSave()) throw new Error('離線授權已取消')
  localStorage.setItem(accessKey, JSON.stringify({ version: 1, grantedAt: now, expiresAt, lastSeenAt: now, salt, verifier }))
}

export async function unlockOfflineAccess(password: string): Promise<boolean> {
  const access = readAccess()
  if (!access) return false
  const raw = localStorage.getItem(accessKey)
  const verifier = await derive(password, access.salt)
  let difference = 0
  verifier.forEach((byte, index) => { difference |= byte ^ access.verifier[index] })
  // Another tab may revoke the grant while the password is being checked.
  if (difference !== 0 || raw !== localStorage.getItem(accessKey) || !readAccess()) return false
  localStorage.setItem(accessKey, JSON.stringify({ ...access, lastSeenAt: Date.now() }))
  return true
}

export function isAuthStorageKey(key: string | null): boolean {
  return key === null || key === accessKey || key === logoutKey
}
