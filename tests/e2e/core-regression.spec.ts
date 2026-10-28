import { expect, test } from './fixtures'

test('saved local data survives an application reload and remains searchable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('重開仍存在測試')
  await page.getByRole('button', { name: '儲存', exact: true }).click()

  await page.reload()
  await page.getByRole('button', { name: '書庫', exact: true }).click()
  const search = page.getByRole('searchbox', { name: '搜尋書庫' })
  await search.fill('重開仍存在')
  await expect(page.getByRole('heading', { name: '重開仍存在測試', exact: true })).toBeVisible()
})

test('deleting a book removes its record and note from every related view', async ({ page }) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? ''
  const startedAt = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`

  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('整體刪除同步測試')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await page.getByRole('button', { name: /^開啟《/ }).click()

  await page.getByRole('button', { name: '更新未分次紀錄（0）' }).click()
  await page.getByRole('button', { name: '新增紀錄' }).click()
  await page.getByLabel('開始時間').fill(startedAt)
  await page.getByLabel('閱讀時間（分鐘）').fill('18')
  await page.getByRole('button', { name: '儲存', exact: true }).click()

  await page.getByRole('button', { name: '更新未分次紀錄（1）' }).click()
  await page.getByRole('button', { name: '短評', exact: true }).click()
  await page.getByLabel('短評內容').fill('刪書時一併消失的短評')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await page.keyboard.press('Escape')

  await page.locator('.book-cover-open').first().click()
  await page.getByText('更多操作', { exact: true }).click()
  await page.getByRole('button', { name: '刪除書籍', exact: true }).click()
  await page.getByRole('button', { name: '確認刪除' }).click()
  await expect(page.getByText('整體刪除同步測試', { exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: '閱讀', exact: true }).click()
  await expect(page.getByRole('heading', { name: '最近閱讀', exact: true })).toBeVisible()
  await expect(page.locator('.recent-book-list')).toHaveCount(0)
  await expect(page.locator('.reading-timeline li')).toHaveCount(0)

  await page.getByRole('button', { name: '書庫', exact: true }).click()
  await page.getByRole('button', { name: '閱讀筆記', exact: true }).click()
  await expect(page.getByText('刪書時一併消失的短評', { exact: true })).toHaveCount(0)
})

