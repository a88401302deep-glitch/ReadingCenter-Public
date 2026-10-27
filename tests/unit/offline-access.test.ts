import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { acknowledgeLogout, clearOfflineAccess, grantOfflineAccess, markLogout, offlineExpiresAt, pendingLogout, unlockOfflineAccess } from '../../src/features/auth/offline-access'

const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
})
afterEach(() => vi.unstubAllGlobals())
const password = 'synthetic-offline-password'
const expiry = () => new Date(Date.now() + 60_000).toISOString()

describe('device offline access', () => {
  it('requires a valid online grant and correct password without storing the password', async () => {
    expect(await unlockOfflineAccess(password)).toBe(false)
    await grantOfflineAccess(password, expiry())
    expect([...values.values()].join()).not.toContain(password)
    expect(await unlockOfflineAccess('wrong')).toBe(false)
    expect(await unlockOfflineAccess(password)).toBe(true)
    clearOfflineAccess()
    expect(await unlockOfflineAccess(password)).toBe(false)
  })
  it('caps access at seven days and rejects expired, damaged and clock-reversed grants', async () => {
    const now = Date.now()
    await grantOfflineAccess(password, new Date(now + 30 * 86_400_000).toISOString(), now)
    expect(offlineExpiresAt()).toBe(now + 7 * 86_400_000)
    const key = [...values.keys()][0]
    const access = JSON.parse(values.get(key)!)
    values.set(key, JSON.stringify({ ...access, lastSeenAt: now + 120_000 }))
    expect(offlineExpiresAt()).toBeNull()
    values.set(key, JSON.stringify({ ...access, expiresAt: now - 1 }))
    expect(await unlockOfflineAccess(password)).toBe(false)
    values.set(key, '{broken')
    expect(offlineExpiresAt()).toBeNull()
  })
  it('retains pending server logout and cannot grant access after revocation', async () => {
    await grantOfflineAccess(password, expiry())
    markLogout()
    expect(pendingLogout()).toBe(true)
    expect(offlineExpiresAt()).toBeNull()
    await expect(grantOfflineAccess(password, expiry())).rejects.toThrow()
    acknowledgeLogout()
    expect(pendingLogout()).toBe(false)
    expect(await unlockOfflineAccess(password)).toBe(false)
    await expect(grantOfflineAccess(password, expiry(), Date.now(), () => false)).rejects.toThrow()
    expect(offlineExpiresAt()).toBeNull()
  })
})
