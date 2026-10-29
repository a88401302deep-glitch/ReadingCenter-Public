import { expect, test } from './fixtures'
// Check the rendered UI rather than token names alone.
function contrast(foreground: string, background: string) {
 const luminance = (rgb: string) => {
  const channels = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
   const channel = value / 255
   return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4
  })
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
 }
 const light = luminance(foreground), dark = luminance(background)
 return (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05)
}
for (const width of [360, 1280]) {
 test(`cover-first pages, explicit imports, pagination and review cards at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 })
  await page.goto('/')
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(250, 241, 239)')
  await expect(page.locator('body')).toHaveCSS('color', 'rgb(81, 66, 72)')
  const selectedNav = page.locator('.nav-item[aria-current="page"]')
  await expect(selectedNav).toHaveCSS('background-color', 'rgb(234, 193, 203)')
  const navColors = await selectedNav.evaluate(node => ({ foreground: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }))
  expect(contrast(navColors.foreground, navColors.background)).toBeGreaterThanOrEqual(4.5)
  await expect(page.getByRole('link', { name: '閱讀中心首頁' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '最近閱讀', exact: true })).toBeInViewport()
  await expect(page.getByRole('button', { name: '統計', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: '新增書籍', exact: true }).click()
  await expect(page.getByRole('region', { name: '新增書目', exact: true })).toBeVisible()
  for (const name of ['匯入備份檔', '截圖', 'Excel', '輸入書名']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Excel', exact: true }).click()
  const csv = '書名,作者,閱讀狀態,完讀日期,短評\n' + Array.from({ length: 35 }, (_, i) => `紙感測試${i + 1},作者甲,已完讀,2026-10-${String(i % 19 + 1).padStart(2, '0')},這是第${i + 1}本心得`).join('\n')
  await page.getByLabel('選擇 Excel 或 CSV').setInputFiles({ name: 'synthetic-books.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByText('35 本待匯入；同名書籍會略過，不覆寫現有資料。')).toBeVisible()
  const importButton = page.getByRole('button', { name: '確認匯入書籍', exact: true })
  await expect(importButton).toHaveCSS('background-color', 'rgb(125, 72, 89)')
  await expect(importButton).toHaveCSS('color', 'rgb(255, 255, 255)')
  const buttonColors = await importButton.evaluate(node => ({ foreground: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }))
  expect(contrast(buttonColors.foreground, buttonColors.background)).toBeGreaterThanOrEqual(4.5)
  await importButton.click()
  const importStartedAt = Date.now()
  try {
   // Observe this bulk write separately from ordinary UI assertions.
   await expect(page.getByText('已新增 35 本，略過 0 本同名書籍。')).toBeVisible({ timeout: 20_000 })
  } finally {
   const observation = {
    elapsedMs: Date.now() - importStartedAt,
    statuses: await page.getByRole('status').allTextContents(),
    alerts: await page.getByRole('alert').allTextContents()
   }
   console.log('spreadsheet-import observation', JSON.stringify(observation))
   await test.info().attach('spreadsheet-import-observation', {
    body: JSON.stringify(observation, null, 2), contentType: 'application/json'
   })
  }
  await page.getByRole('button', { name: '書庫', exact: true }).click()
  await expect(page.locator('.book-row')).toHaveCount(30)
  await expect(page.getByLabel('依閱讀狀態篩選')).toBeHidden()
  await expect(page.getByRole('status', { name: '書庫符合筆數' })).toHaveCount(0)
  await page.getByRole('button', { name: '書庫篩選', exact: true }).click()
  await expect(page.getByRole('status', { name: '書庫符合筆數' })).toHaveText('35／35 本')
  await expect(page.getByLabel('依閱讀狀態篩選')).toBeVisible()
  if (width === 360) expect(await page.locator('.book-list--covers').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2)
  await expect(page.getByLabel('依資料完整度篩選')).toBeVisible()
  await page.getByRole('button', { name: '書庫篩選', exact: true }).click()
  await expect(page.getByLabel('依閱讀狀態篩選')).toBeHidden()
  await page.getByRole('button', { name: '下一頁', exact: true }).first().click()
  await expect(page.locator('.book-row')).toHaveCount(5)
  await page.getByRole('searchbox', { name: '搜尋書庫' }).fill('紙感測試1')
  await expect(page.locator('.book-row')).toHaveCount(11)
  await page.getByRole('button', { name: '開啟《紙感測試1》', exact: true }).click()
  const zoom = page.getByRole('dialog', { name: '《紙感測試1》', exact: true })
  await expect(zoom.locator('.book-cover')).toBeVisible()
  await zoom.getByRole('button', { name: '關閉', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: '搜尋書庫' })).toHaveValue('紙感測試1')
  await page.getByRole('button', { name: '書庫篩選', exact: true }).click()
  await page.getByLabel('依資料完整度篩選').selectOption('封面')
  await expect(page.locator('.book-row')).toHaveCount(11)
  await page.getByRole('button', { name: '清單模式', exact: true }).click()
  await expect(page.locator('.cover-library .book-cover, .cover-library .book-progress')).toHaveCount(0)
  await expect(page.locator('.library-list-authors').first()).toHaveText('作者甲')
  const listModeColors = await page.getByRole('button', { name: '清單模式', exact: true }).evaluate(node => ({ foreground: getComputedStyle(node).color, background: getComputedStyle(node).backgroundColor }))
  expect(contrast(listModeColors.foreground, listModeColors.background)).toBeGreaterThanOrEqual(4.5)
  await page.getByRole('button', { name: '書庫篩選', exact: true }).click()
  await expect(page.getByRole('status', { name: '書庫符合筆數' })).toHaveCount(0)
  await expect(page.getByRole('searchbox', { name: '搜尋書庫' })).toHaveValue('紙感測試1')
  await expect(page.locator('.book-row')).toHaveCount(11)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: '閱讀', exact: true }).click()
  const recent = page.getByRole('region', { name: '最近閱讀', exact: true })
  await expect(recent.getByRole('listitem')).toHaveCount(10)
  const cardStyle = await recent.getByRole('listitem').first().evaluate(n => ({ border: getComputedStyle(n).borderWidth, padding: parseFloat(getComputedStyle(n).paddingTop), background: getComputedStyle(n).backgroundColor }))
  expect(cardStyle.border).toBe('0px')
  expect(cardStyle.padding).toBe(0)
  expect(cardStyle.background).toBe('rgba(0, 0, 0, 0)')
  await expect(recent.getByRole('progressbar').first()).toHaveCSS('color', 'rgb(183, 126, 141)')
  await expect(recent.getByRole('progressbar').first()).toHaveCSS('background-color', 'rgb(238, 223, 225)')
  await expect(recent.getByRole('progressbar').first()).toHaveAttribute('value', '100')
  await expect(recent).not.toContainText('進度未記錄')
  await expect(recent).not.toContainText('100%')
  await expect(recent.locator('.recent-book-cover').first()).toBeInViewport()
  const reviews = page.getByRole('region', { name: '閱讀心得', exact: true })
  await expect(reviews.locator('.book-cover')).toHaveCount(6)
  await page.getByRole('button', { name: '閱讀筆記', exact: true }).click()
  await expect(page.locator('.note-card')).toHaveCount(35)
  await expect(page.locator('.note-card-cover')).toHaveCount(35)
  await page.locator('.note-book-title').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: '關閉', exact: true }).click()
  await page.getByRole('button', { name: '管理', exact: true }).click()
  await expect(page.getByRole('button', { name: '備份資料庫', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '匯入資料庫', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '偏好設定', exact: true })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
 })
}
