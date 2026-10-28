import { expect, test } from './fixtures'
import type { Page } from '@playwright/test'

async function openSyntheticBook(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍', exact: true }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('筆電版面驗收（合成資料）')
  await page.getByLabel('作者（每行一位）', { exact: true }).fill('林予晴（合成資料）')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await page.getByRole('button', { name: '開啟《筆電版面驗收（合成資料）》', exact: true }).click()
}

test.describe('short laptop viewport', () => {
  test.use({ isMobile: false, hasTouch: false, deviceScaleFactor: 1.5 })
  for (const [width, height] of [[960, 640], [1024, 640], [1152, 648], [1280, 720]]) {
    test(`keeps useful columns and compact controls at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await openSyntheticBook(page)
      const metrics = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, ratio: devicePixelRatio, fine: matchMedia('(pointer:fine)').matches }))
      expect(metrics.fine).toBe(true)
      const dialog = page.getByRole('dialog')
      const card = (await page.locator('.book-detail-book-card').boundingBox())!
      const reading = (await page.locator('.book-detail-reading').boundingBox())!
      expect(reading.x).toBeGreaterThanOrEqual(card.x + card.width)
      expect(Math.abs(reading.y - card.y)).toBeLessThanOrEqual(1)
      const cover = (await page.locator('.book-detail-cover').boundingBox())!
      expect(cover.width).toBeGreaterThanOrEqual(144)
      expect(cover.width).toBeLessThanOrEqual(201)
      const header = page.locator('.book-card-heading')
      expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64)
      const emptyReview = page.locator('.reading-content-manager')
      expect((await emptyReview.boundingBox())!.height).toBeLessThan(160)
      await expect.poll(() => dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1)
      await dialog.screenshot({ path: test.info().outputPath(`laptop-${width}x${height}.png`) })
      await test.info().attach('viewport-metrics', { body: JSON.stringify(metrics), contentType: 'application/json' })
      await page.getByRole('button', { name: '編輯書籍資料', exact: true }).click()
      await expect(page.getByRole('dialog', { name: '編輯書籍', exact: true }).getByRole('button', { name: '儲存', exact: true })).toBeInViewport()
      await page.getByRole('button', { name: '離開書籍編輯', exact: true }).click()
    })
  }
})

test.describe('tablet viewport', () => {
  test.use({ isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  test('retains the touch layout at 1024px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await openSyntheticBook(page)
    expect(await page.evaluate(() => matchMedia('(pointer:coarse)').matches)).toBe(true)
    const card = (await page.locator('.book-detail-book-card').boundingBox())!
    const reading = (await page.locator('.book-detail-reading').boundingBox())!
    expect(reading.y).toBeGreaterThanOrEqual(card.y + card.height)
    expect((await page.locator('.book-detail-cover').boundingBox())!.width).toBe(240)
  })
})
