import { expect, test } from './fixtures'

test('full-screen book editor closes by its cancel action or Escape', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByRole('button', { name: '離開書籍編輯' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Modal requires confirmation before discarding an edited book form', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('尚未儲存')

  page.once('dialog', async (dialog) => {
    expect(dialog.type()).toBe('confirm')
    await dialog.dismiss()
  })
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeVisible()

  page.once('dialog', async (dialog) => dialog.accept())
  await page.getByRole('button', { name: '離開書籍編輯' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
