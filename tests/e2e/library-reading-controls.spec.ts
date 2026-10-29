import { expect, test } from './fixtures'

test('six covers across desktop and iPad, floating close and direct completed-book rating persist', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  for (let i = 1; i <= 7; i++) {
    await page.getByRole('button', { name: '新增書籍', exact: true }).click()
    await page.getByRole('button', { name: '輸入書名', exact: true }).click()
    await page.getByLabel('出版書名', { exact: true }).fill(`六欄書架 ${i}`)
    await page.getByRole('button', { name: '儲存', exact: true }).click()
  }
  for (const width of [1440, 1024, 744, 360]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.locator('.book-row')).toHaveCount(7)
    const rows = await page.locator('.book-row').evaluateAll(elements => elements.map(el => el.getBoundingClientRect().top))
    expect(rows.filter(top => Math.abs(top - rows[0]) < 1)).toHaveLength(width >= 700 ? 6 : 2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: '開啟《六欄書架 1》', exact: true }).click()
  const detail = page.getByRole('dialog', { name: '《六欄書架 1》', exact: true })
  expect((await detail.boundingBox())!.width).toBeCloseTo(1376, 0)
  await expect(detail.getByText('ISBN', { exact: true })).toHaveCount(0)
  await detail.evaluate(el => { el.scrollTop = el.scrollHeight })
  const close = detail.getByRole('button', { name: '關閉', exact: true })
  const bounds = (await close.boundingBox())!
  expect(bounds.y).toBeGreaterThanOrEqual(0)
  expect(bounds.y + bounds.height).toBeLessThan(900)
  await detail.getByRole('button', { name: '編輯閱讀紀錄', exact: true }).click()
  await page.getByLabel('書籍閱讀狀態').selectOption('completed')
  await close.click()
  const stars = page.getByRole('group', { name: '《六欄書架 1》評分：尚未評分', exact: true })
  await expect(stars.getByRole('button')).toHaveCount(5)
  await stars.getByRole('button', { name: '評為 4 星' }).click()
  await expect(page.getByRole('group', { name: '《六欄書架 1》評分：4 星', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: '書庫', exact: true }).click()
  await expect(page.getByRole('group', { name: '《六欄書架 1》評分：4 星', exact: true })).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('six-column-library.png'), fullPage: true })
})
