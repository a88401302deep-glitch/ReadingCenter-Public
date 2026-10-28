import { expect, test, enterManagement } from './fixtures'

test('creates and displays an ordered reading cycle from the library', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('重讀測試')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await page.getByRole('button', { name: /^開啟《/ }).click()
  await enterManagement(page, '閱讀')
  await page.getByRole('button', { name: '新增一次閱讀' }).click()
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '第 1 次閱讀', exact: true })).toBeVisible()
  await expect(page.locator('.cycle-list li').first().getByText('閱讀中', { exact: true })).toBeVisible()
})

