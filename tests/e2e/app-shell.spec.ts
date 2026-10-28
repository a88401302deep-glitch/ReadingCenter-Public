import { expect, test } from './fixtures'

for (const width of [360, 1440]) test(`starts with the ReadingCenter shell and shared navigation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '最近閱讀' })).toBeVisible()
  const nav = page.getByRole('navigation', { name: '主要導覽' })
  await expect(nav.getByRole('button')).toHaveCount(3)
  await expect(nav.locator('.entry-icon[aria-hidden="true"]')).toHaveCount(3)
  await expect(nav.locator('.icon--solid')).toHaveCount(3)
  if (width < 761) await expect(nav.locator('.nav-label').first()).toBeHidden()
  else await expect(nav.locator('.nav-label').first()).toBeVisible()
  for (const button of await nav.getByRole('button').all()) {
    expect(await button.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44)
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: test.info().outputPath(`entry-icons-${width}.png`) })
  await page.getByRole('button', { name: '書庫' }).click()
  await expect(nav.getByRole('button', { name: '書庫', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { name: '書庫', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '書庫', exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜尋書庫' })).toBeVisible()
  await nav.getByRole('button', { name: '閱讀筆記', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(nav.getByRole('button', { name: '閱讀筆記', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: '管理' }).click()
  await expect(page.getByRole('heading', { name: '管理', exact: true })).toBeVisible()
})
