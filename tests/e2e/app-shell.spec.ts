import { expect, test } from './fixtures'

test('starts with the ReadingCenter shell and shared navigation', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: '最近閱讀' })).toBeVisible()
  await page.getByRole('button', { name: '書庫' }).click()
  await expect(page.getByRole('heading', { name: '書庫', exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '書庫', exact: true })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜尋書庫' })).toBeVisible()
  await page.getByRole('button', { name: '管理' }).click()
  await expect(page.getByRole('heading', { name: '管理', exact: true })).toBeVisible()
})
