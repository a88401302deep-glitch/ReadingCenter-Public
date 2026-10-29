import { readFile } from 'node:fs/promises'
import { test, expect, enterManagement } from './fixtures'

for (const choice of ['local', 'remote'] as const) {
  test(`reviews a real UI conflict, adopts ${choice}, and exports both retained copies`, async ({ page, baseURL }) => {
    if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Review fixture requires the local preview')
    const rows = new Map<string, Record<string, unknown>>()
    const replayed = new Map<string, Record<string, unknown>>()
    await page.route(`${baseURL}/api/v1/**`, async (route) => {
      const request = route.request()
      const parts = new URL(request.url()).pathname.split('/')
      if (parts[3] === 'auth' && parts[4] === 'session') {
        await route.fulfill({ json: { data: { authenticated: true } } }); return
      }
      if (parts[3] !== 'entities') throw new Error('Unexpected review endpoint')
      const kind = parts[4], id = parts[5] ? decodeURIComponent(parts[5]) : undefined
      if (request.method() === 'GET') {
        if (id) {
          await route.fulfill(rows.has(id) ? { json: { data: rows.get(id) } }
            : { status: 404, json: { error: { code: 'not_found', message: 'Not found' } } })
        } else await route.fulfill({ json: { data: [...rows.values()].filter((row) => row.kind === kind) } })
        return
      }
      const body = request.postDataJSON()
      if (replayed.has(body.mutationId)) { await route.fulfill({ json: { data: replayed.get(body.mutationId) } }); return }
      const current = rows.get(id!)
      if ((current?.revision ?? 0) !== body.baseRevision) {
        await route.fulfill({ status: 409, json: { error: { code: 'revision_conflict', message: 'Conflict', current: current ?? null } } }); return
      }
      const entity = body.entity
      const row = { kind, id, revision: entity.revision, createdAt: entity.createdAt, updatedAt: entity.updatedAt,
        schemaVersion: entity.schemaVersion, provenance: entity.provenance, deletedAt: null, payload: entity }
      rows.set(id!, row); replayed.set(body.mutationId, row)
      await route.fulfill({ json: { data: row } })
    })
    await page.goto('/')
    await expect(page.locator('.sync-status[role="status"]')).toHaveText('已同步。')
    await page.getByRole('button', { name: '新增書籍', exact: true }).first().click()
    await page.getByRole('button', { name: '輸入書名', exact: true }).click()
    await page.getByLabel('出版書名', { exact: true }).fill('核對瀏覽器合成初版')
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect.poll(() => rows.size).toBe(1)
    await expect(page.locator('.sync-status[role="status"]')).toHaveText('已同步。')
    await page.locator('.book-cover-open').first().click()
  await enterManagement(page, '書籍')
    await page.getByLabel('出版書名', { exact: true }).fill('本機核對選擇內容')
    const [id, original] = [...rows.entries()][0]
    rows.set(id, { ...original, revision: 2, payload: { ...(original.payload as Record<string, unknown>), revision: 2, title: '遠端核對選擇內容' } })
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.locator('.sync-status[role="status"]')).toContainText('同步衝突')
    await expect(page.locator('.book-form')).toHaveCount(0)
    await page.getByRole('button', { name: '關閉', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: '管理', exact: true }).click()
    await page.locator('.sync-indicator').click()
    await page.getByRole('button', { name: '核對同步問題', exact: true }).click()
    await page.getByRole('button', { name: '核對', exact: true }).click()
    const comparison = page.getByRole('table', { name: '本機與遠端內容比較' })
    await expect(comparison).toContainText('本機核對選擇內容')
    await expect(comparison).toContainText('遠端核對選擇內容')
    const confirm = page.getByRole('button', { name: '確認此筆結果', exact: true })
    await expect(confirm).toBeDisabled()
    await page.getByRole('radio', { name: choice === 'local' ? '採用本機版本並同步' : '採用遠端版本', exact: true }).check()
    await expect(confirm).toBeDisabled()
    await page.getByRole('checkbox', { name: '我已核對兩方內容，確認採用所選結果', exact: true }).check()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await confirm.click()
    await expect(page.locator('.sync-status[role="status"]')).toHaveText('已同步。')
    await expect(page.getByText('目前沒有待核對項目。', { exact: true })).toBeVisible()
    const expectedTitle = choice === 'local' ? '本機核對選擇內容' : '遠端核對選擇內容'
    await expect.poll(() => (rows.get(id)?.payload as { title?: string })?.title).toBe(expectedTitle)
    expect(rows.get(id)?.revision).toBe(choice === 'local' ? 3 : 2)
    await page.getByText('已核對的保留副本（1）', { exact: true }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '匯出核對保留副本', exact: true }).click()])
    const saved = JSON.parse(await readFile((await download.path())!, 'utf8'))
    expect(saved.archives[0].review.local.title).toBe('本機核對選擇內容')
    expect(saved.archives[0].review.remote.payload.title).toBe('遠端核對選擇內容')
    await page.getByRole('button', { name: '書庫', exact: true }).click()
    await expect(page.getByRole('heading', { name: expectedTitle, exact: true })).toBeVisible()
  })
}

