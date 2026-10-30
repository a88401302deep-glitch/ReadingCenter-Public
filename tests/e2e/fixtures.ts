import { test as base, expect, type Page } from '@playwright/test'

/** Explicit user step; leaves all content visible while enabling its tools. */
export async function enterManagement(page: Page, scope: '書籍' | '閱讀' | '心得') {
  const labels = { 書籍: ['編輯書籍資料', '完成書籍編輯'], 閱讀: ['編輯閱讀紀錄', '完成閱讀編輯'], 心得: ['編輯心得', '完成心得編輯'] }[scope]
  const trigger = page.getByRole('button', { name: labels[0], exact: true })
  const done = page.getByRole('button', { name: labels[1], exact: true })
  await expect(trigger.or(done)).toBeVisible()
  if (await trigger.count()) {
    await trigger.click()
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

/** A local upload response supplies an existing synthetic SVG; no deployed API is used. */
export async function stageSyntheticCover(page: Page, path: string) {
  await page.route('**/api/v1/covers/manual', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { cover: { path, mimeType: 'image/jpeg', width: 600, height: 840 } } }) }))
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 840
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#eac1cb'; ctx.fillRect(0, 0, 600, 840)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.getByLabel('選擇封面', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
}
