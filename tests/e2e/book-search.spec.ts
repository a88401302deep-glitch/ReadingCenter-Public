import { expect, test } from './fixtures'

test('newly created book is immediately searchable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('唐草人偶')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByRole('heading', { name: '唐草人偶' })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜尋書庫' }).fill('唐草')
  await expect(page.getByRole('heading', { name: '唐草人偶' })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜尋書庫' }).fill('不存在')
  await expect(page.getByText('沒有符合條件的書籍')).toBeVisible()
})
