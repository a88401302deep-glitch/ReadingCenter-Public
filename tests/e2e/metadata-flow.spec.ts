import { expect, test } from './fixtures'

test('publisher maintenance is visible without calling a failed search empty or blocking manual input', async ({ page }) => {
 await page.route('**/api/v1/books/metadata?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], partial: true, warnings: ['讀書共和國目前導向官方維護公告，暫時無法搜尋。'], diagnostics: [{ source: '讀書共和國', status: 'failed', kind: 'maintenance', count: 0 }, { source: 'Google Books', status: 'ok', count: 7 }] }) }))
 await page.setViewportSize({ width: 360, height: 780 })
 await page.goto('/')
 await page.getByRole('button', { name: '新增書籍', exact: true }).click()
 await page.getByRole('button', { name: '輸入書名', exact: true }).click()
 await page.getByLabel('出版書名', { exact: true }).fill('京都怪奇談')
 await page.getByText('搜尋並補全書籍資料', { exact: true }).click()
 await page.getByRole('button', { name: '查詢書籍資料', exact: true }).click()
 for (const width of [360, 1280]) {
  await page.setViewportSize({ width, height: 780 })
  await expect(page.getByRole('alert')).toContainText('讀書共和國目前導向官方維護公告')
  await expect(page.getByRole('list', { name: '搜尋來源狀態' })).toContainText('讀書共和國：官方維護中')
  await expect(page.getByRole('list', { name: '搜尋來源狀態' })).toContainText('Google Books：取得 7 筆候選')
  await expect(page.getByText(/^查無書目資料/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '重試搜尋' })).toBeVisible()
  await expect(page.getByLabel('出版書名', { exact: true })).toHaveValue('京都怪奇談')
  await expect(page.getByRole('button', { name: '儲存', exact: true })).toBeEnabled()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
 }
})

test('mobile metadata search separates choosing a book, reviewing changes and applying to the form', async ({ page }) => {
 await page.setViewportSize({ width: 360, height: 780 })
 await page.route('**/api/v1/books/metadata?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
  { id: 'ol:OL1M', source: 'Open Library', title: '候選書名', authors: ['候選作者'], publisher: '候選出版社', isbn: '', publishedOn: '', sourceUrl: 'https://openlibrary.org/books/OL1M', coverUrl: null },
  { id: 'ol:OL2M', source: 'Open Library', title: '另一個版本', authors: ['其他作者'], publisher: '其他出版社', isbn: '', publishedOn: '', sourceUrl: 'https://openlibrary.org/books/OL2M', coverUrl: null }
 ] }) }))
 await page.goto('/')
 await page.getByRole('button', { name: '新增書籍' }).click()
 await page.getByRole('button', { name: '輸入書名', exact: true }).click()
 await page.getByLabel('出版書名', { exact: true }).fill('人工書名')
 await page.getByLabel('作者（每行一位）').fill('人工作者')
 await page.getByRole('button', { name: '儲存', exact: true }).click()
 await page.locator('.book-cover-open').first().click()
  await page.getByRole('button', { name: '編輯書籍', exact: true }).click()
 const editor = page.locator('.book-form')
 await editor.getByText('搜尋並補全書籍資料', { exact: true }).click()
 await editor.getByRole('button', { name: '查詢書籍資料' }).click()
 await expect(editor.getByRole('button', { name: '核對《候選書名》' })).toBeVisible()
 await expect(editor.getByRole('button', { name: '帶入下列表單' })).toHaveCount(0)
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
 await editor.getByRole('button', { name: '核對《候選書名》' }).click()
 await expect(editor.getByRole('heading', { name: '候選書名' })).toBeVisible()
 await expect(editor.getByText('保留原資料', { exact: true })).toHaveCount(2)
 await expect(editor.getByRole('group', { name: '選擇要套用的欄位：候選書名' })).not.toBeVisible()
 await editor.getByRole('button', { name: '帶入下列表單' }).click()
 await expect(editor.getByRole('status').filter({ hasText: '已帶入下列表單：出版社' })).toBeVisible()
 await expect(editor.getByLabel('作者（每行一位）')).toHaveValue('人工作者')
 await expect(editor.getByLabel('出版書名', { exact: true })).toHaveValue('人工書名')
 await expect(editor.getByLabel('出版社', { exact: true })).toHaveValue('候選出版社')
 await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1)
 page.once('dialog', dialog => dialog.accept())
 await editor.getByRole('button', { name: '取消', exact: true }).click()
 await expect(editor).toHaveCount(0)
})


test('search dialog traps focus, cancels safely and retries without losing the book draft', async ({ page }) => {
 await page.setViewportSize({ width: 360, height: 780 })
 let release!: () => void
 const pending = new Promise<void>(resolve => { release = resolve })
 let lookups = 0
 await page.route('**/api/v1/books/metadata?**', async route => {
  lookups++
  if (lookups === 1) await pending
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }).catch(() => undefined)
 })
 await page.goto('/')
 await page.getByRole('button', { name: '新增書籍', exact: true }).click()
 await page.getByRole('button', { name: '輸入書名', exact: true }).click()
 await page.getByLabel('出版書名', { exact: true }).fill('保留原始書名')
 await page.getByText('搜尋並補全書籍資料', { exact: true }).click()
 await page.getByRole('button', { name: '查詢書籍資料', exact: true }).click()
 const dialog = page.getByRole('dialog', { name: '正在尋找書籍資料…' })
 await expect(dialog).toBeVisible()
 await expect(dialog.getByRole('button', { name: '取消搜尋' })).toBeFocused()
 const bounds = await dialog.boundingBox()
 expect(bounds!.width).toBeLessThanOrEqual(360)
 expect(Math.abs(bounds!.x + bounds!.width / 2 - 180)).toBeLessThan(2)
 await page.keyboard.press('Escape')
 await expect(dialog).toHaveCount(0)
 release()
 await expect(page.getByLabel('出版書名', { exact: true })).toHaveValue('保留原始書名')
 await page.getByRole('button', { name: '重試搜尋', exact: true }).click()
 await expect(page.getByText('查無書目資料；已保留書名與閱讀紀錄，可直接確認匯入，日後再補全。')).toBeVisible()
 await expect(page.getByLabel('出版書名', { exact: true })).toHaveValue('保留原始書名')
 await expect(page.getByRole('button', { name: '儲存', exact: true })).toBeEnabled()
 expect(lookups).toBe(2)
 await page.getByRole('button', { name: '取消', exact: true }).click()
})
