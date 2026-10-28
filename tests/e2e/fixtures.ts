import { test as base, expect, type Page } from '@playwright/test'

/** Explicit user step; leaves all content visible while enabling its tools. */
export async function enterManagement(page: Page, scope: '書籍' | '閱讀' | '心得') {
  const labels = { 書籍: ['編輯書籍資料', '完成書籍編輯'], 閱讀: ['編輯閱讀紀錄', '完成閱讀編輯'], 心得: ['編輯心得', '完成心得編輯'] }[scope]
  const trigger = page.getByRole('button', { name: labels[0], exact: true })
  const done = page.getByRole('button', { name: labels[1], exact: true })
  await expect(trigger.or(done)).toBeVisible()
  if (await trigger.count()) {
    await trigger.click()
    // Existing section-tool scenarios start after the directly opened editor.
    if (scope === '書籍') await page.getByRole('button', { name: '離開書籍編輯', exact: true }).click()
  }
}

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
