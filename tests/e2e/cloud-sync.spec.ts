import type { Page } from '@playwright/test'
import { test, expect, enterManagement } from './fixtures'

test('signed-in edits reach another device and remote reads do not echo writes', async ({ page, browser, baseURL }) => {
  if (!baseURL || new URL(baseURL).hostname !== '127.0.0.1') throw new Error('Sync fixture requires the local preview')
  const rows = new Map<string, Record<string, unknown>>()
  const replayed = new Map<string, Record<string, unknown>>()
  let writes = 0
  const connect = async (target: Page) => {
    await target.route(`${baseURL}/api/v1/**`, async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      if (url.pathname === '/api/v1/auth/session') {
        await route.fulfill({ json: { data: { authenticated: true } } })
        return
      }
      const parts = url.pathname.split('/')
      if (parts[3] !== 'entities') throw new Error('Unexpected sync fixture endpoint')
      const kind = parts[4]
      if (request.method() === 'GET') {
        await route.fulfill({ json: { data: [...rows.values()].filter((row) => row.kind === kind) } })
        return
      }
      writes += 1
      const body = request.postDataJSON()
      if (replayed.has(body.mutationId)) {
        await route.fulfill({ json: { data: replayed.get(body.mutationId) } })
        return
      }
      const id = decodeURIComponent(parts[5])
      const current = rows.get(id)
      if ((current?.revision ?? 0) !== body.baseRevision) {
        await route.fulfill({ status: 409, json: { error: { code: 'revision_conflict', message: 'Conflict', current } } })
        return
      }
      const entity = body.entity
      const row = request.method() === 'DELETE'
        ? { ...current, revision: Number(current?.revision) + 1, deletedAt: body.deletedAt, updatedAt: body.deletedAt, payload: null }
        : { kind, id, revision: entity.revision, createdAt: entity.createdAt, updatedAt: entity.updatedAt,
          schemaVersion: entity.schemaVersion, provenance: entity.provenance, deletedAt: null, payload: entity }
      rows.set(id, row)
      replayed.set(body.mutationId, row)
      await route.fulfill({ json: { data: row } })
    })
  }
  const refresh = async (target: Page) => {
    await target.getByRole('button', { name: '管理', exact: true }).click()
    await target.locator('.sync-indicator').click()
    await target.getByRole('button', { name: '核對同步問題', exact: true }).click()
    await target.getByRole('button', { name: '立即同步', exact: true }).click()
    await expect(target.getByRole('button', { name: '立即同步', exact: true })).toBeEnabled()
    await expect(target.locator('.sync-status[role="status"]')).toHaveText('已同步。')
    await target.getByRole('button', { name: '書庫', exact: true }).click()
  }
  await connect(page)
  await page.goto('/')
  await expect(page.locator('.sync-status[role="status"]')).toHaveText('已同步。')
  await page.getByRole('button', { name: '新增書籍', exact: true }).first().click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名', { exact: true }).fill('跨裝置瀏覽器合成資料')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.locator('.sync-status[role="status"]')).toHaveText('已同步。')
  await expect.poll(() => rows.size).toBe(1)

  const secondContext = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  try {
    const second = await secondContext.newPage()
    await connect(second)
    await second.goto('/')
    await expect(second.locator('.sync-status[role="status"]')).toHaveText('已同步。')
    await second.getByRole('button', { name: '書庫', exact: true }).click()
    await expect(second.getByRole('heading', { name: '跨裝置瀏覽器合成資料' })).toBeVisible()
    await second.locator('.book-cover-open').first().click()
    await enterManagement(second, '書籍')
    await second.getByRole('button', { name: '編輯書籍', exact: true }).click()
    await second.getByLabel('出版書名', { exact: true }).fill('另一裝置更新合成資料')
    await second.getByRole('button', { name: '儲存', exact: true }).click()
    await expect.poll(() => (rows.values().next().value?.payload as { title?: string } | undefined)?.title).toBe('另一裝置更新合成資料')
    await refresh(page)
    await expect(page.getByRole('heading', { name: '另一裝置更新合成資料' })).toBeVisible()
    expect(writes).toBe(2)
  } finally {
    await secondContext.close()
  }
})

