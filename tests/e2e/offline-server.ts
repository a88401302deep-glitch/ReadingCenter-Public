import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { test as base, expect } from '@playwright/test'

interface OfflineServer { url: string; signedIn: boolean; remoteCalls: number; suspend: () => Promise<void>; resume: () => Promise<void> }

// A real loopback server keeps API responses observable when WebKit's Service
// Worker owns the request and bypasses Playwright page.route interception.
export const test = base.extend<{ offlineServer: OfflineServer }>({
  offlineServer: async ({ browserName }, runFixture) => {
    const state: OfflineServer = { url: '', signedIn: false, remoteCalls: 0, suspend: async () => undefined, resume: async () => undefined }
    const root = resolve('dist')
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
      '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
      '.png': 'image/png', '.ico': 'image/x-icon' }
    const server = createServer(async (request, response) => {
      const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
      if (path.startsWith('/api/v1/')) {
        if (path === '/api/v1/auth/login' && request.method === 'POST') state.signedIn = true
        if (path === '/api/v1/auth/logout' && request.method === 'POST') state.signedIn = false
        const auth = path.startsWith('/api/v1/auth/')
        if (!auth) state.remoteCalls += 1
        response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        response.end(JSON.stringify({ data: auth ? { authenticated: state.signedIn,
          ...(state.signedIn ? { expiresAt: new Date(Date.now() + 3600_000).toISOString() } : {}) } : [] }))
        return
      }
      const file = resolve(root, '.' + (path === '/' ? '/index.html' : path))
      if (!file.startsWith(root + sep)) { response.writeHead(404); response.end(); return }
      try {
        const content = await readFile(file)
        response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' })
        response.end(content)
      } catch { response.writeHead(404); response.end() }
    })
    await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error(`Loopback test server unavailable for ${browserName}`)
    state.url = `http://127.0.0.1:${address.port}/`
    state.suspend = () => new Promise<void>((done, reject) => {
      if (!server.listening) { done(); return }
      server.close((error) => error ? reject(error) : done())
      server.closeAllConnections()
    })
    state.resume = () => new Promise<void>((done, reject) => {
      server.once('error', reject)
      server.listen(address.port, '127.0.0.1', done)
    })
    try { await runFixture(state) } finally {
      await state.suspend()
    }
  }
})

export { expect }
