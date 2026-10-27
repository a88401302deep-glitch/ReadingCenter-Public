import { expect, test } from './fixtures'

test('manages a reading record in the compact cycle popover', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('閱讀紀錄測試')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await page.getByRole('button', { name: /^開啟《/ }).click()
  await page.getByText('修改狀態／重讀', { exact: true }).click()
  await page.getByRole('button', { name: '新增一次閱讀' }).click()
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  const cycle = page.locator('.cycle-list li').first()
  await cycle.getByRole('button', { name: '手動補登（0）' }).click()
  await page.getByRole('button', { name: '新增紀錄' }).click()
  await page.getByLabel('開始時間').fill('2026-09-14T20:00')
  await page.getByLabel('閱讀時間（分鐘）').fill('30')
  await page.getByLabel('目前進度').fill('25')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.locator('.record-popover').getByText('30 分鐘')).toBeVisible()
  await expect(page.locator('.record-popover').getByText('25%')).toBeVisible()
})

