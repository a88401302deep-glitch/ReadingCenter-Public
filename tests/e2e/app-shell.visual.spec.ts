import type { Page, TestInfo } from '@playwright/test'
import { expect, test, enterManagement } from './fixtures'

const visualBaselineTime = new Date('2026-09-13T00:00:00.000Z')

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(visualBaselineTime)
})

test('desktop app shell responsive layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '最近閱讀', exact: true })).toBeVisible()
  await captureLayout(page, testInfo, 'app-shell-desktop.png', { fullPage: true })
})

test('mobile app shell responsive layout', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '最近閱讀', exact: true })).toBeVisible()
  await captureLayout(page, testInfo, 'app-shell-mobile-360.png', { fullPage: true })
})


test('filled reading overview shows covers and count charts on phone and desktop', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 360, height: 780 })
  await page.goto('/')
  for (const [index, title] of ['閱讀的風景', '日常的練習', '穿越海洋的故事'].entries()) {
    await page.getByRole('button', { name: '新增書籍', exact: true }).click()
    await page.getByRole('button', { name: '輸入書名', exact: true }).click()
    await page.getByLabel('出版書名', { exact: true }).fill(title)
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await page.locator('article.book-row').filter({ has: page.getByRole('heading', { name: title, exact: true }) }).getByRole('button', { name: /^開啟《/ }).click()
    await enterManagement(page, '閱讀')
    await page.getByRole('button', { name: '新增一次閱讀', exact: true }).click()
    await page.locator('.cycle-form').getByRole('combobox').selectOption('completed')
    await page.getByLabel('結束時間', { exact: true }).fill(`2026-09-${10 + index}T10:30`)
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.locator('.cycle-form')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  }
  await page.getByRole('button', { name: '閱讀', exact: true }).click()
  await expect(page.locator('.recent-book-cards > li')).toHaveCount(3)
  await expect(page.locator('.site-header')).not.toContainText('閱讀中心')
  await expect(page.getByLabel('累計讀完 3 本，書庫總數 3 本')).toBeVisible()
  for (const selector of ['.recent-book-cards > li', '.finished-cards > li']) {
    const cards = page.locator(selector)
    const first = (await cards.nth(0).boundingBox())!, second = (await cards.nth(1).boundingBox())!, third = (await cards.nth(2).boundingBox())!
    expect(Math.abs(first.y - second.y)).toBeLessThan(2)
    expect(second.x).toBeGreaterThan(first.x)
    expect(third.y).toBeGreaterThan(first.y + first.height)
    expect(await cards.nth(0).evaluate(node => getComputedStyle(node).borderTopWidth)).toBe('0px')
  }
  await expect(page.locator('.recent-book-cards .cover-zoom-trigger')).toHaveCount(0)
  await expect(page.locator('.finished-cards strong, .finished-cards time')).toHaveCount(0)
  for (const button of await page.locator('.header-actions > .icon-button').all()) {
    expect(await button.evaluate(node => getComputedStyle(node).borderTopWidth)).toBe('0px')
  }
  await expect(page.getByRole('region', { name: '書籍字數統計' })).toHaveCount(0)
  await expect(page.locator('.recent-book-cover').first()).toBeInViewport()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await captureLayout(page, testInfo, 'reading-overview-filled-mobile.png', { fullPage: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await captureLayout(page, testInfo, 'reading-overview-filled-desktop.png', { fullPage: true })

})


/** Intentional redesign: check the layout contract and attach the actual rendering.
 * The previous PNGs describe the earlier design and remain as historical references.
 * Re-establish pixel baselines after reviewing the new design on both engines.
 */
async function captureLayout(page: Page, testInfo: TestInfo, name: string, options: { fullPage: boolean }) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  const nav = page.getByRole('navigation', { name: '主要導覽' })
  await expect(nav).toBeVisible()
  if ((page.viewportSize()?.width ?? 1000) <= 640) {
    const bounds = await nav.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1)
    expect(bounds!.y).toBeGreaterThan(page.viewportSize()!.height - 100)
  }
  const undersized = await page.locator('input:visible, select:visible, textarea:visible').evaluateAll(fields => fields.filter(field => Number.parseFloat(getComputedStyle(field).fontSize) < 16).length)
  expect(undersized).toBe(0)
  await testInfo.attach(name, { body: await page.screenshot(options), contentType: 'image/png' })
}

