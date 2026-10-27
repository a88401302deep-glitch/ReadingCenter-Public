import { expect, test } from './offline-server'

// Deliberately uses the built app's real Service Worker, without the local-reading fixture.
test.use({ serviceWorkers: 'allow' })
test('authorized device cold-starts from the real PWA cache, queues edits, and stays locked after offline logout', async ({ page, context, offlineServer, browserName }) => {
  // Playwright #42775: WebKit's offline flag kills SW-served navigations.
  // Stop the real origin instead and separately emulate the browser's offline indicator.
  if (browserName === 'webkit') {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true,
        get: () => localStorage.getItem('test:offline-network') !== 'true' })
    })
  }
  await page.goto(offlineServer.url)
  await page.getByLabel('密碼', { exact: true }).fill('synthetic-device-password')
  await page.getByRole('checkbox', { name: /允許此裝置離線使用/ }).check()
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await expect(page.getByRole('button', { name: '書庫', exact: true })).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true })
    })
  })
  const cachedShell = await page.evaluate(async () => {
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      if ((await cache.keys()).some((request) => new URL(request.url).pathname === '/index.html')) return true
    }
    return false
  })
  expect(cachedShell).toBe(true)
  if (browserName === 'webkit') {
    await offlineServer.suspend()
    await page.evaluate(() => {
      localStorage.setItem('test:offline-network', 'true')
      window.dispatchEvent(new Event('offline'))
    })
  } else await context.setOffline(true)
  expect(await page.evaluate(async () => {
    try { await fetch('/__uncached_network_probe__', { cache: 'no-store' }); return false }
    catch { return true }
  })).toBe(true)
  const reload = await page.reload()
  expect(reload?.status()).toBe(200)
  await expect(page.getByRole('button', { name: '書庫', exact: true })).toHaveCount(0)
  await page.getByLabel('密碼', { exact: true }).fill('synthetic-device-password')
  await page.getByRole('button', { name: '開啟離線副本' }).click()
  await expect(page.getByRole('button', { name: '書庫', exact: true })).toBeVisible()
  const before = offlineServer.remoteCalls
  const entityAttempts: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/v1/entities/')) entityAttempts.push(request.url())
  })
  await page.getByRole('button', { name: '新增書籍', exact: true }).first().click()
  await page.getByRole('button', { name: '輸入書名', exact: true }).click()
  await page.getByLabel('出版書名').fill('離線冷啟動合成資料')
  await page.getByRole('button', { name: '儲存', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(offlineServer.remoteCalls).toBe(before)
  expect(entityAttempts).toEqual([])
  const outboxCount = () => page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('reading-center-local')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const count = db.transaction('syncOutbox').objectStore('syncOutbox').count()
      count.onsuccess = () => { resolve(count.result); db.close() }
      count.onerror = () => { reject(count.error); db.close() }
    }
  }))
  await expect.poll(outboxCount).toBe(1)
  await page.getByRole('button', { name: '管理', exact: true }).click()
  await page.getByRole('button', { name: '登出', exact: true }).click()
  await expect(page.getByLabel('密碼', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '書庫', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '開啟離線副本' })).toHaveCount(0)
  expect(await outboxCount()).toBe(1)
  if (browserName === 'webkit') {
    await offlineServer.resume()
    await page.evaluate(() => {
      localStorage.removeItem('test:offline-network')
      window.dispatchEvent(new Event('online'))
    })
  } else await context.setOffline(false)
  await expect(page.getByRole('button', { name: '登入', exact: true })).toBeVisible()
  await expect.poll(() => offlineServer.signedIn).toBe(false)
})
