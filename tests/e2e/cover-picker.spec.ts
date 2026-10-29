import { expect, test, enterManagement } from './fixtures'

test('new book cover picker previews exact pixels, allows retry, and saves the adopted image under the same book identity', async ({ page }, testInfo) => {
 // WebKit may omit binary request bodies from its interception protocol. Observe
 // the actual Blob passed to native fetch, without replacing or modifying it.
 await page.addInitScript(() => {
  const nativeFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
   if (String(input) === '/api/v1/covers/manual' && init?.body instanceof Blob) {
    (window as Window & { coverUploadBytes?: number[] }).coverUploadBytes = Array.from(new Uint8Array(await init.body.arrayBuffer()))
   }
   return nativeFetch(input, init)
  }
 })
 const png = await page.evaluate(() => {
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1135
  const context = canvas.getContext('2d')!
  context.fillStyle = '#733b35'; context.fillRect(0, 0, 800, 1135)
  context.fillStyle = '#ead8b5'; context.fillRect(100, 100, 600, 800)
  return canvas.toDataURL('image/png').split(',')[1]
 })
 const title = '【本機測試】獨立封面選取', uploads: { id: string; bytes: Buffer }[] = []
 await page.route('**/api/v1/books/metadata?**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
  { id: 'gb:picker1', source: 'Google Books', title: '候選書名', authors: ['來源作者'], publisher: '', isbn: '', publishedOn: '', sourceUrl: 'https://books.google.com/books?id=picker1', coverUrl: '/api/v1/books/metadata/cover?google=picker1' },
  { id: 'gb:picker2', source: 'Google Books', title: '另一冊封面', authors: ['來源作者'], publisher: '', isbn: '', publishedOn: '', sourceUrl: 'https://books.google.com/books?id=picker2', coverUrl: '/api/v1/books/metadata/cover?google=picker2' },
 ], partial: false }) }))
 await page.route('**/api/v1/books/metadata/cover?**', route => route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from(png, 'base64') }))
 await page.route('**/api/v1/covers/manual', async route => {
  const body = route.request().postDataBuffer() ?? Buffer.from(await page.evaluate(() => (window as Window & { coverUploadBytes?: number[] }).coverUploadBytes ?? []))
  expect(body.length).toBeGreaterThan(0)
  uploads.push({ id: route.request().headers()['x-book-id'], bytes: body })
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { cover: { path: '/api/v1/covers/covers/picker.jpg', mimeType: 'image/jpeg' } } }) })
 })
 await page.route('**/api/v1/covers/covers/picker.jpg', route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: uploads[0].bytes }))
 await page.setViewportSize({ width: 360, height: 780 })
 await page.goto('/')
 await page.getByRole('button', { name: '新增書籍', exact: true }).click()
 await page.getByRole('button', { name: '輸入書名', exact: true }).click()
 const form = page.locator('.book-form')
 await form.getByLabel('出版書名', { exact: true }).fill(title)
 await form.getByLabel('作者（每行一位）').fill('人工作者')
 await form.getByRole('button', { name: '選擇封面／重新找封面' }).click()
 await expect(form.getByLabel('搜尋書名', { exact: true })).toHaveValue(title)
 await form.getByRole('button', { name: '尋找候選封面' }).click()
 await expect(form.getByRole('button', { name: '預覽此封面' })).toHaveCount(2)
 await form.getByRole('button', { name: '預覽此封面' }).first().click()
 await expect(form.getByRole('region', { name: '候選封面原圖預覽' })).toContainText('800 × 1135 像素')
 expect(uploads).toHaveLength(0)
 await form.getByRole('button', { name: '放棄這張，選另一張' }).click()
 await form.getByRole('button', { name: '重新找封面', exact: true }).click()
 await form.getByRole('button', { name: '預覽此封面' }).last().click()
 for (const width of [360, 1280]) {
  await page.setViewportSize({ width, height: 780 })
  await expect(form.getByRole('button', { name: '採用這張封面' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
 }
 await page.setViewportSize({ width: 360, height: 780 })
 await form.getByRole('button', { name: '採用這張封面' }).click()
 await expect(form.getByAltText('封面預覽')).toBeVisible()
 await expect(form.getByLabel('出版書名', { exact: true })).toHaveValue(title)
 await expect(form.getByLabel('作者（每行一位）')).toHaveValue('人工作者')
 expect(uploads).toHaveLength(0)
 await form.getByAltText('封面預覽').scrollIntoViewIfNeeded()
 await page.screenshot({ path: testInfo.outputPath('cover-picker-360.png') })
 await form.getByRole('button', { name: '儲存', exact: true }).click()
 await expect(form).toHaveCount(0)
 expect(uploads).toHaveLength(1)
 const uploaded = await page.evaluate(async base64 => {
  const bytes = Uint8Array.from(atob(base64), char => char.charCodeAt(0))
  const image = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }))
  const dimensions = { width: image.width, height: image.height }; image.close(); return dimensions
 }, uploads[0].bytes.toString('base64'))
 expect(uploaded).toEqual({ width: 800, height: 1135 })
 await page.getByRole('button', { name: `開啟《${title}》`, exact: true }).click()
 expect(await page.evaluate(() => history.state.readingCenterBookId)).toBe(uploads[0].id)
 await expect(page.getByRole('region', { name: '書籍封面' }).getByRole('img')).toHaveJSProperty('naturalWidth', 800)
 await enterManagement(page, '書籍')
 await expect(page.getByLabel('出版書名', { exact: true })).toHaveValue(title)
 await page.getByLabel('選擇封面', { exact: true }).setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
 page.once('dialog', prompt => prompt.accept())
 await page.getByRole('button', { name: '取消', exact: true }).click()
 expect(uploads).toHaveLength(1)
 const coverRegion = page.getByRole('region', { name: '書籍封面' })
 await expect(coverRegion.getByRole('img')).toHaveJSProperty('naturalWidth', 800)
 await enterManagement(page, '書籍')
 await page.getByLabel('選擇封面', { exact: true }).setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
 await page.getByRole('button', { name: '儲存', exact: true }).click()
 await expect(page.locator('.book-form')).toHaveCount(0)
 expect(uploads).toHaveLength(2)
 expect(uploads[1].id).toBe(uploads[0].id)
 await enterManagement(page, '書籍')
 await expect(page.getByLabel('出版書名', { exact: true })).toHaveValue(title)
 await expect(page.getByLabel('作者（每行一位）')).toHaveValue('人工作者')
})
