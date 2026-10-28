import { expect, test, enterManagement } from './fixtures'

test('manages a reading record in the compact cycle popover', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '新增書籍' }).click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('閱讀紀錄測試')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await page.getByRole('button', { name: /^開啟《/ }).click()
  await enterManagement(page, '閱讀')
  await page.getByRole('button', { name: '新增一次閱讀' }).click()
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  const cycle = page.locator('.cycle-list li').first()
  await enterManagement(page, '閱讀')
  await cycle.getByRole('button', { name: '更新閱讀紀錄（0）' }).click()
  if (page.viewportSize()!.width <= 760) {
    const bounds = await page.getByRole('dialog', { name: '第 1 次閱讀紀錄', exact: true }).evaluate(node => {
      const rect = node.getBoundingClientRect()
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: innerWidth, height: innerHeight }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(bounds.width)
    expect(bounds.bottom).toBeLessThanOrEqual(bounds.height)
  }
  await expect(page.getByRole('button', { name: '新增紀錄' })).toBeInViewport()
  await page.getByRole('button', { name: '新增紀錄' }).click()
  await page.getByLabel('開始時間').fill('2026-09-14T20:00')
  await page.getByLabel('閱讀時間（分鐘）').fill('30')
  await page.getByLabel('目前進度').fill('25')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.locator('.record-popover').getByText('30 分鐘')).toBeVisible()
  await expect(page.locator('.record-popover').getByText('25%')).toBeVisible()
})

