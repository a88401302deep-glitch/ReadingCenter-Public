import { test as base, expect } from '@playwright/test'

/** Static preview has no Worker API. Exercise local reading workflows explicitly. */
export const test = base.extend({
  // A controlling PWA worker can bypass page.route after reload, especially in WebKit.
  // Local UI tests validate IndexedDB persistence; production offline PWA needs separate acceptance.
  serviceWorkers: 'block',
  page: async ({ page, baseURL }, runTest) => {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') {
      throw new Error('Local reading fixtures must not target a deployed site')
    }
    await page.route(`${baseURL}/api/v1/auth/session`, (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'auth_not_configured' } })
    }))
    await runTest(page)
  }
})

export { expect }
