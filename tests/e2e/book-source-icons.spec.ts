import { expect, test } from './fixtures'
test('source URLs render as accessible icon links without exposing long URL text', async ({ page }) => {
 await page.goto('/')
 await page.getByRole('button', { name:'新增書籍', exact:true }).click()
 await page.getByRole('button', { name:'輸入書名', exact:true }).click()
 await page.getByLabel('出版書名', { exact:true }).fill('來源圖示合成測試')
 await page.getByLabel('相關連結（每行一個）').fill('https://books.google.com/books?id=synthetic\nhttps://example.com/book/synthetic')
 await page.getByRole('button', { name:'儲存', exact:true }).click()
 await page.getByRole('button', { name:'開啟《來源圖示合成測試》', exact:true }).click()
 const links=page.locator('.book-detail-links a')
 await expect(links).toHaveCount(2)
 const google=page.getByRole('link', { name:'開啟相關連結：Google Books', exact:true })
 await expect(google).toHaveAttribute('href','https://books.google.com/books?id=synthetic')
 await expect(google).toHaveAttribute('target','_blank')
 await expect(google).toHaveAttribute('rel','noopener noreferrer')
 for(const link of await links.all()) {
  await expect(link).toHaveText('')
  await expect(link.locator('svg')).toHaveCount(1)
  const box=(await link.boundingBox())!
  expect(box.width).toBeGreaterThanOrEqual(44)
  expect(box.height).toBeGreaterThanOrEqual(44)
 }
 await page.locator('.book-detail-links').screenshot({path:test.info().outputPath('source-icons.png')})
})
