import { expect, test } from '@playwright/test'

// These tests intentionally do not use the local-reading fixture.
test('production build keeps private UI behind the configured session gate', async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ data: { authenticated: false } })
  }))
  await page.goto('/')
  await expect(page.getByLabel('密碼', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '書庫', exact: true })).toHaveCount(0)
})

test('production build reports an invalid session response instead of exposing the app', async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<html>Static preview fallback</html>'
  }))
  await page.goto('/')
  await expect(page.getByRole('alert')).toHaveText('目前無法連線')
  await expect(page.getByRole('button', { name: '書庫', exact: true })).toHaveCount(0)
})
