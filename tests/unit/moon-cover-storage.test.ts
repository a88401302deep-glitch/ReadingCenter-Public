import { expect, it } from 'vitest'
import { handleCoverAssetApi } from '../../worker/cover-assets'

it('stores authenticated Moon covers for UUID books as durable files and serves their original bytes', async () => {
  const objects = new Map<string, ArrayBuffer>()
  const kv = { put: async (key: string, bytes: ArrayBuffer) => { objects.set(key, bytes) }, get: async (key: string) => objects.get(key) ?? null }
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])
  const result = await handleCoverAssetApi(new Request('https://example.test/api/v1/covers/moon', { method: 'POST', body: bytes, headers: { 'Content-Type': 'image/png', 'X-Book-Id': 'ec5c6199-af3e-4d36-87da-343e5e9d6c5a', 'X-Book-Title': encodeURIComponent('測試書籍') } }), kv, false)
  expect(result.status).toBe(201)
  const cover = (await result.json()).data.cover
  const downloaded = await handleCoverAssetApi(new Request('https://example.test'+cover.path), kv, false)
  expect(downloaded.status).toBe(200)
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(bytes)
  expect(downloaded.headers.get('Content-Type')).toBe('image/png')
})

it('rejects unsafe book identities and invalid image bytes without storing them', async () => {
  let stored = false
  const kv = { put: async () => { stored = true }, get: async () => null }
  for (const id of ['../../private', 'ec5c6199-af3e-4d36-87da-343e5e9d6c5a']) {
    const response = await handleCoverAssetApi(new Request('https://example.test/api/v1/covers/moon', { method: 'POST', body: 'not an image', headers: { 'Content-Type': 'image/png', 'X-Book-Id': id, 'X-Book-Title': 'test' } }), kv, true)
    expect([400, 415]).toContain(response.status)
  }
  expect(stored).toBe(false)
})

it('replaces manual covers through new immutable keys for imported and UUID books without overwriting prior bytes', async () => {
 const objects = new Map<string, ArrayBuffer>()
 const kv = { put: async (key: string, bytes: ArrayBuffer) => { objects.set(key, bytes) }, get: async (key: string) => objects.get(key) ?? null }
 for (const id of ['ec5c6199-af3e-4d36-87da-343e5e9d6c5a', `notion:book:${'a'.repeat(64)}:1`]) {
   const paths = []
   for (const marker of [1, 2]) {
     const response = await handleCoverAssetApi(new Request('https://example.test/api/v1/covers/manual', { method: 'POST', body: new Uint8Array([255,216,marker,255,217]), headers: { 'Content-Type': 'image/jpeg', 'X-Book-Id': id, 'X-Book-Title': encodeURIComponent('封面/測試') } }), kv, false)
     expect(response.status).toBe(201); paths.push((await response.json()).data.cover.path)
   }
   expect(paths[0]).not.toBe(paths[1])
   for(const path of paths) expect((await handleCoverAssetApi(new Request('https://example.test'+path), kv, false)).status).toBe(200)
 }
 expect(objects.size).toBe(4)
})
