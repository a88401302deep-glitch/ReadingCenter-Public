import { expect, test } from './fixtures'

test('creates, edits, and deletes a short review in the book modal', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('短評操作測試')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await page.getByRole('button', { name: /^開啟《/ }).click()
  await page.getByRole('button', { name: '短評', exact: true }).click()
  await page.getByLabel('短評內容').fill('第一則短評')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByText('第一則短評', { exact: true })).toBeVisible()
  const item = page.locator('.reading-content-list li').filter({ hasText: '第一則短評' })
  await item.getByRole('button', { name: '編輯' }).click()
  await page.getByLabel('短評內容').fill('修改後短評')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByText('修改後短評', { exact: true })).toBeVisible()
  await page.locator('.reading-content-list li').filter({ hasText: '修改後短評' }).getByRole('button', { name: '刪除' }).click()
  await page.getByRole('button', { name: '確認刪除' }).click()
  await expect(page.getByText('修改後短評', { exact: true })).toHaveCount(0)
})

