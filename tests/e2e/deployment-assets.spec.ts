import { expect, test } from './fixtures'

test('PWA production assets are complete and use Traditional Chinese metadata', async ({ page, request }) => {
  await page.goto('/')

  const manifestPath = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestPath).toBeTruthy()
  const manifestResponse = await request.get(manifestPath ?? '/manifest.webmanifest')
  expect(manifestResponse.ok()).toBe(true)
  const manifest = await manifestResponse.json()
  expect(manifest).toMatchObject({
    name: 'ReadingCenter 閱讀中心',
    short_name: '閱讀中心',
    lang: 'zh-Hant',
    display: 'standalone'
  })

  for (const path of ['/sw.js', '/icons/pwa-192x192.png', '/icons/pwa-512x512.png']) {
    const response = await request.get(path)
    expect(response.ok()).toBe(true)
  }
})
