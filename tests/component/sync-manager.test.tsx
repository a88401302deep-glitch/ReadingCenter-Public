// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSyncingIndexedDbRepositories, type SyncingLocalRepositoryContext } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { SyncManager } from '../../src/features/sync/SyncManager'
import type { Book } from '../../src/domain'

const contexts: SyncingLocalRepositoryContext[] = []
const now = '2026-10-01T00:00:00.000Z'
afterEach(async () => {
  cleanup()
  for (const local of contexts.splice(0)) await local.deleteDatabase()
  vi.unstubAllGlobals()
})
async function setup() {
  const local = createSyncingIndexedDbRepositories(`review-ui-${crypto.randomUUID()}`)
  contexts.push(local)
  const book = await new BookService(local.rawRepositories, () => 'review-ui', () => now).create({ title: '本機核對合成資料', mediaTypeId: 'ebook' })
  let remote: Book | null = { ...book, title: '遠端核對合成資料', revision: 2 }
  let offline = false
  const row = () => remote ? { kind: 'book', id: remote.id, revision: remote.revision, createdAt: remote.createdAt,
    updatedAt: remote.updatedAt, schemaVersion: remote.schemaVersion, provenance: remote.provenance, deletedAt: null, payload: remote } : null
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    if (offline) throw new TypeError('offline')
    const path = new URL(String(input), 'https://test.local').pathname
    if (path.endsWith(`/book/${book.id}`)) return row() ? Response.json({ data: row() }) : Response.json({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 })
    return Response.json({ data: path.endsWith('/book') && row() ? [row()] : [] })
  })
  vi.stubGlobal('fetch', fetcher)
  const onResolved = vi.fn()
  const mount = () => render(<SyncManager local={local} message="有資料待核對" syncing={false} onBack={vi.fn()} onRetry={vi.fn()} onResolved={onResolved} />)
  const open = async () => { fireEvent.click(await screen.findByRole('button', { name: '核對' })) }
  const choose = (choice: 'local' | 'remote') => {
    fireEvent.click(screen.getByRole('radio', { name: choice === 'local' ? '採用本機版本並同步' : '採用遠端版本' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '我已核對兩方內容，確認採用所選結果' }))
  }
  return { local, book, onResolved, fetcher, mount, open, choose,
    setRemote: (value: Book | null) => { remote = value }, setOffline: () => { offline = true } }
}

describe('sync review UI', () => {
  it('compares both copies without a default choice and requires acknowledgement before queueing the decision', async () => {
    const fixture = await setup(); fixture.mount(); await fixture.open()
    expect(screen.getByRole('table', { name: '本機與遠端內容比較' }).textContent).toContain('遠端核對合成資料')
    expect((screen.getByRole('button', { name: '確認此筆結果' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true)
    fireEvent.click(screen.getByRole('radio', { name: '採用本機版本並同步' }))
    expect((screen.getByRole('button', { name: '確認此筆結果' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '確認此筆結果' }))
    await waitFor(() => expect(fixture.onResolved).toHaveBeenCalledOnce())
    expect((await fixture.local.outbox.getAll())[0]).toMatchObject({ baseRevision: 2, entity: { title: fixture.book.title, revision: 3 } })
    expect(await fixture.local.database.syncReviewArchive.count()).toBe(1)
    await screen.findByText('目前沒有待核對項目。')
  })

  it('adopts the remote copy and retains the replaced local content in review history', async () => {
    const fixture = await setup(); fixture.mount(); await fixture.open(); fixture.choose('remote')
    fireEvent.click(screen.getByRole('button', { name: '確認此筆結果' }))
    await waitFor(() => expect(fixture.onResolved).toHaveBeenCalledOnce())
    expect(await fixture.local.repositories.books.getById(fixture.book.id)).toMatchObject({ title: '遠端核對合成資料' })
    expect(await fixture.local.outbox.getAll()).toEqual([])
    expect((await fixture.local.database.syncReviewArchive.toArray())[0].review.local?.id).toBe(fixture.book.id)
    await screen.findByText('已核對的保留副本（1）')
  })

  it('requires reloading after a newer local edit and does not remove that edit', async () => {
    const fixture = await setup(); fixture.mount(); await fixture.open(); fixture.choose('remote')
    await new BookService(fixture.local.repositories).update(fixture.book.id, { title: '核對後新輸入', mediaTypeId: 'ebook' })
    fireEvent.click(screen.getByRole('button', { name: '確認此筆結果' }))
    await screen.findByText('資料在核對後已有變動；請重新載入並核對')
    expect((screen.getByRole('button', { name: '確認此筆結果' }) as HTMLButtonElement).disabled).toBe(true)
    expect(await fixture.local.outbox.getAll()).toHaveLength(1)
    expect(await fixture.local.database.syncReviewArchive.count()).toBe(0)
    expect(fixture.onResolved).not.toHaveBeenCalled()
  })

  it('keeps the data and choice if the network fails during confirmation', async () => {
    const fixture = await setup(); fixture.mount(); await fixture.open(); fixture.choose('local'); fixture.setOffline()
    fireEvent.click(screen.getByRole('button', { name: '確認此筆結果' }))
    await screen.findByText('無法連線；核對決定尚未儲存，請連線後重試')
    expect(await fixture.local.repositories.books.getById(fixture.book.id)).toEqual(fixture.book)
    expect(await fixture.local.database.syncReviewArchive.count()).toBe(0)
    expect(fixture.onResolved).not.toHaveBeenCalled()
  })

  it('disables choosing imported local data over a manual remote version', async () => {
    const fixture = await setup()
    await fixture.local.rawRepositories.books.save({ ...fixture.book, provenance: { kind: 'import', sourceId: 'notion', externalId: 'synthetic', importedAt: now } })
    fixture.mount(); await fixture.open()
    expect((screen.getByRole('radio', { name: '採用本機版本並同步' }) as HTMLInputElement).disabled).toBe(true)
    await screen.findByText('遠端資料由人工維護，匯入內容不能覆蓋；請採用遠端版本。')
    fireEvent.click(screen.getByRole('button', { name: '暫不處理' }))
    expect(screen.queryByRole('article', { name: '逐筆同步核對' })).toBeNull()
    expect(await fixture.local.database.syncReviewArchive.count()).toBe(0)
  })
})
