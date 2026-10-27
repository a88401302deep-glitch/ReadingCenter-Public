// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncingLocalRepositoryContext } from '../../src/data'
import { App } from '../../src/app/App'
import { BookService } from '../../src/features/books/book-service'
import type { Book } from '../../src/domain'

const state = vi.hoisted(() => ({ local: undefined as SyncingLocalRepositoryContext | undefined,
  name: '', enabled: true, localAccess: undefined as boolean | undefined, contexts: [] as SyncingLocalRepositoryContext[] }))
vi.mock('../../src/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data')>()
  return { ...actual, createSyncingIndexedDbRepositories: () => {
    const local = actual.createSyncingIndexedDbRepositories(state.name)
    state.local = local; state.contexts.push(local)
    return local
  } }
})
vi.mock('../../src/features/auth/auth-context', () => ({ useAuth: () => ({ authEnabled: state.enabled, localAccess: state.localAccess, logout: vi.fn() }) }))

beforeEach(() => { state.name = `app-sync-${crypto.randomUUID()}`; state.enabled = true; state.localAccess = undefined })
afterEach(async () => {
  cleanup()
  for (const local of state.contexts.splice(0)) await local.deleteDatabase()
  vi.unstubAllGlobals()
})

function envelope(book: Book) {
  return { kind: 'book', id: book.id, revision: book.revision, createdAt: book.createdAt,
    updatedAt: book.updatedAt, schemaVersion: book.schemaVersion, provenance: book.provenance,
    deletedAt: null, payload: book }
}

describe('App cloud sync wiring', () => {
  it('reads remote books after login, refreshes the library, and exposes a working retry control', async () => {
    const { createInMemoryRepositories } = await import('../../src/data')
    const book = await new BookService(createInMemoryRepositories(), () => 'remote-ui-book').create({ title: '遠端合成書籍', mediaTypeId: 'ebook' })
    const fetcher = vi.fn(async (url: RequestInfo | URL) => Response.json({ data: String(url).includes('/book?') ? [envelope(book)] : [] }))
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    await screen.findByText('已同步。')
    fireEvent.click(screen.getByRole('button', { name: '書庫' }))
    await screen.findByRole('heading', { name: '遠端合成書籍' })
    expect(await state.local!.outbox.getAll()).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    fireEvent.click(screen.getByRole('button', { name: /^同步狀態/ }))
    fireEvent.click(screen.getByRole('button', { name: '核對同步問題' }))
    const before = fetcher.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: '立即同步' }))
    await waitFor(() => expect(fetcher.mock.calls.length).toBeGreaterThan(before))
    await waitFor(() => expect((screen.getByRole('button', { name: '立即同步' }) as HTMLButtonElement).disabled).toBe(false))
  })

  it('queues an actual UI edit offline, keeps it visible, and sends it when the network returns', async () => {
    let offline = true
    let remoteBook: Book | undefined
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      if (offline) throw new TypeError('offline')
      if (init?.method === 'PUT') {
        remoteBook = JSON.parse(String(init.body)).entity
        return Response.json({ data: envelope(remoteBook!) })
      }
      return Response.json({ data: String(url).includes('/book?') && remoteBook ? [envelope(remoteBook)] : [] })
    })
    vi.stubGlobal('fetch', fetcher)
    const mounted = render(<App />)
    await screen.findByText(/無法連線/)
    fireEvent.click(screen.getAllByRole('button', { name: '新增書籍' })[0])
    fireEvent.click(screen.getByRole('button', { name: '輸入書名' }))
    fireEvent.change(screen.getByLabelText('出版書名'), { target: { value: '離線 UI 合成書籍' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await screen.findByRole('heading', { name: '離線 UI 合成書籍' })
    expect(await state.local!.outbox.getAll()).toHaveLength(1)
    offline = false
    state.enabled = false; state.localAccess = true
    mounted.rerender(<App />)
    state.enabled = true
    mounted.rerender(<App />)
    await screen.findByText('已同步。')
    expect(remoteBook?.title).toBe('離線 UI 合成書籍')
    expect(await state.local!.outbox.getAll()).toEqual([])
  })

  it('does not start entity sync in local mode', async () => {
    state.enabled = false
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '管理' }))
    expect(screen.queryByRole('button', { name: '同步' })).toBeNull()
    expect(screen.getByRole('button', { name: '備份資料庫' })).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('queues real edits with local access but performs no remote requests until session verification', async () => {
    state.enabled = false; state.localAccess = true
    const fetcher = vi.fn(async () => Response.json({ data: [] }))
    vi.stubGlobal('fetch', fetcher)
    const mounted = render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: '新增書籍' })[0])
    fireEvent.click(screen.getByRole('button', { name: '輸入書名' }))
    fireEvent.change(screen.getByLabelText('出版書名'), { target: { value: '離線冷啟動合成書籍' } })
    fireEvent.click(screen.getByRole('button', { name: '儲存' }))
    await waitFor(async () => expect(await state.local!.outbox.getAll()).toHaveLength(1))
    expect(fetcher).not.toHaveBeenCalled()
    state.enabled = true
    mounted.rerender(<App />)
    await waitFor(() => expect(fetcher).toHaveBeenCalled())
  })

})
