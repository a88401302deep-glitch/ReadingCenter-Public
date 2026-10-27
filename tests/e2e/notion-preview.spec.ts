import { expect, test } from './fixtures'
// Historical Notion review has unit coverage; management now exposes explicit import/backup tasks.
test('Excel previews clear when leaving, and duplicate titles never overwrite existing books', async ({ page }) => {
 await page.goto('/')
 const open = async () => { await page.getByRole('button', { name: '新增書籍', exact: true }).click(); await page.getByRole('button', { name: 'Excel', exact: true }).click() }
 const csv = { name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from('書名,作者\n同名保護,原作者') }
 await open(); await page.getByLabel('選擇 Excel 或 CSV').setInputFiles(csv)
 await expect(page.getByRole('table')).toContainText('同名保護')
 await page.getByRole('button', { name: '返回新增方式', exact: true }).click()
 await page.getByRole('button', { name: 'Excel', exact: true }).click()
 await expect(page.getByRole('table')).toHaveCount(0)
 await page.getByLabel('選擇 Excel 或 CSV').setInputFiles(csv)
 await page.getByRole('button', { name: '確認匯入書籍', exact: true }).click()
 await expect(page.getByText('已新增 1 本，略過 0 本同名書籍。')).toBeVisible()
 await page.getByLabel('選擇 Excel 或 CSV').setInputFiles({ ...csv, buffer: Buffer.from('書名,作者\n同名保護,不應覆寫作者') })
 await page.getByRole('button', { name: '確認匯入書籍', exact: true }).click()
 await expect(page.getByText('已新增 0 本，略過 1 本同名書籍。')).toBeVisible()
 await page.getByRole('button', { name: '書庫', exact: true }).click()
 await expect(page.locator('.book-row')).toHaveCount(1)
 await page.getByRole('button', { name: '開啟《同名保護》', exact: true }).click()
 await expect(page.getByRole('dialog')).toContainText('原作者')
 await expect(page.getByRole('dialog')).not.toContainText('不應覆寫作者')
})
