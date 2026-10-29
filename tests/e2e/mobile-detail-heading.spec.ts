import { expect, test } from './fixtures'
for (const width of [320, 390]) test(`mobile detail title bands stay compact at ${width}px`, async ({ page }) => {
 await page.setViewportSize({ width, height:844 })
 await page.goto('/')
 await page.getByRole('button', { name:'新增書籍', exact:true }).click()
 await page.getByRole('button', { name:'輸入書名', exact:true }).click()
 await page.getByLabel('出版書名', { exact:true }).fill('手機標頭合成測試')
 await page.getByRole('button', { name:'儲存', exact:true }).click()
 await page.getByRole('button', { name:'開啟《手機標頭合成測試》', exact:true }).click()
 const headers=page.locator('.book-card-heading, .book-detail-reading > .book-detail-panel-heading, .reading-content-manager > .section-heading')
 await expect(headers).toHaveCount(3)
 for (const header of await headers.all()) {
  const title=(await header.locator('h3').boundingBox())!, button=(await header.getByRole('button').boundingBox())!, box=(await header.boundingBox())!
  expect(Math.abs(title.y+title.height/2-button.y-button.height/2)).toBeLessThan(2)
  expect(box.height).toBeLessThanOrEqual(80)
  expect(button.height).toBeGreaterThanOrEqual(44)
  expect(button.x+button.width).toBeLessThanOrEqual(box.x+box.width)
 }
 const notes=page.locator('.reading-content-manager')
 await notes.scrollIntoViewIfNeeded()
 await notes.screenshot({ path:test.info().outputPath(`mobile-notes-${width}.png`) })
 await notes.getByRole('button', { name:'編輯心得', exact:true }).click()
 await expect(notes.getByRole('button', { name:'長篇心得', exact:true })).toBeVisible()
 expect(await page.locator('.book-detail').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1)
})
