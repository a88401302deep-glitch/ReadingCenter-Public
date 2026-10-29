import { expect, test } from './fixtures'

test.use({ hasTouch: true, deviceScaleFactor: 2 })
for (const width of [360, 1024, 1366]) test(`sparse metadata stays compact beside its cover on touch at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1024 })
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍', exact: true }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('一段比較長的合成書名，用來檢查平板版面')
  await page.getByLabel('作者（每行一位）', { exact: true }).fill('合成作者')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await page.getByRole('button', { name: /^開啟《/ }).click()
  const detail = page.locator('.book-detail')
  await expect(detail.locator('.book-publication-row')).toHaveCount(1)
  await expect(detail.locator('.book-publication-row dt')).toHaveText(['作者'])
  await expect(detail.getByText('書籍版本', { exact: true })).toHaveCount(0)
  await expect(detail.getByText('ISBN', { exact: true })).toHaveCount(0)
  await expect(detail.locator('.book-detail-sparse-hint')).toContainText('僅顯示已填資料')
  for (const row of await detail.locator('.book-publication-row').all()) expect((await row.boundingBox())!.height).toBeLessThan(110)
  if (width >= 1024) {
    const cover = (await detail.locator('.book-detail-cover').boundingBox())!
    const info = (await detail.locator('.book-detail-information').boundingBox())!
    const introduction = (await detail.locator('.book-detail-introduction').boundingBox())!
    expect(Math.abs(introduction.y - cover.y)).toBeLessThan(2)
    expect(info.y).toBeGreaterThanOrEqual(introduction.y + introduction.height)
    expect(info.height).toBeLessThan(cover.height)
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await page.getByRole('dialog').screenshot({ path: test.info().outputPath(`sparse-book-${width}.png`) })
  await detail.getByRole('button', { name: '編輯書籍資料', exact: true }).click()
  await expect(page.getByLabel('出版書名', { exact: true })).toHaveValue('一段比較長的合成書名，用來檢查平板版面')
  await page.getByRole('button', { name: '離開書籍編輯', exact: true }).click()
  await expect(detail.locator('.book-detail-sparse-hint')).toBeVisible()
})
