// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { NotionReviewQueue } from '../../src/features/import/NotionReviewQueue'
import { AuthGate } from '../../src/features/auth/AuthGate'
import { AuthContext } from '../../src/features/auth/auth-context'
import { openNotionZip } from '../../src/import/notion-zip-reader'
vi.mock('../../src/import/notion-zip-reader', () => ({ openNotionZip: vi.fn() }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
const zip = { filenames: ['books.csv', 'cover.jpg'], readCsv: async () => '', readImage: async () => new Uint8Array() }
function mount() {
  return render(<AuthContext.Provider value={{ authEnabled: true, logout: async () => undefined }}><NotionReviewQueue rows={[]} csvSha256={'a'.repeat(64)} repositories={{ books: {} } as never} /></AuthContext.Provider>)
}
it('shows loading and success, and enables comparison only after the archive is loaded', async () => {
  let finish!: (value: typeof zip) => void
  vi.mocked(openNotionZip).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  mount()
  fireEvent.change(screen.getByLabelText('選擇批次封面 ZIP'), { target: { files: [new File(['zip'], 'export.zip')] } })
  expect(screen.getByRole('status', { name: '封面 ZIP 狀態' }).textContent).toContain('正在讀取封面 ZIP：export.zip')
  expect((screen.getByRole('button', { name: '比對補封面' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => finish(zip))
  expect(screen.getByRole('status', { name: '封面 ZIP 狀態' }).textContent).toContain('已載入封面 ZIP：export.zip（2 個檔案）')
  expect((screen.getByRole('button', { name: '比對補封面' }) as HTMLButtonElement).disabled).toBe(false)
})
it('displays a failed archive and keeps comparison disabled', async () => {
  vi.mocked(openNotionZip).mockRejectedValue(new Error('ZIP directory is missing'))
  mount()
  fireEvent.change(screen.getByLabelText('選擇批次封面 ZIP'), { target: { files: [new File(['bad'], 'bad.zip')] } })
  expect((await screen.findByRole('alert')).textContent).toContain('ZIP directory is missing')
  expect(screen.queryByRole('status', { name: '封面 ZIP 狀態' })).toBeNull()
  expect((screen.getByRole('button', { name: '比對補封面' }) as HTMLButtonElement).disabled).toBe(true)
})
it('keeps the latest selected archive when an older read finishes later', async () => {
  const completions: Array<(value: typeof zip) => void> = []
  vi.mocked(openNotionZip).mockImplementation(() => new Promise((resolve) => completions.push(resolve)))
  mount()
  const input = screen.getByLabelText('選擇批次封面 ZIP')
  fireEvent.change(input, { target: { files: [new File(['zip'], 'older.zip')] } })
  fireEvent.change(input, { target: { files: [new File(['zip'], 'latest.zip')] } })
  await act(async () => completions[1](zip))
  await act(async () => completions[0]({ ...zip, filenames: ['old.csv'] }))
  expect(screen.getByRole('status', { name: '封面 ZIP 狀態' }).textContent).toContain('latest.zip（2 個檔案）')
})

it('preserves the ZIP input through focus revalidation and still locks on an invalid session', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: { authenticated: true } }))
  vi.stubGlobal('fetch', fetcher)
  vi.mocked(openNotionZip).mockResolvedValue(zip)
  try {
    // Flush the initial session state and its effects before dispatching focus.
    await act(async () => {
      render(<AuthGate forceAuthentication><NotionReviewQueue rows={[]} csvSha256={'a'.repeat(64)} repositories={{ books: {} } as never} /></AuthGate>)
    })
    const input = await screen.findByLabelText('選擇批次封面 ZIP')
    let complete!: (response: Response) => void
    fetcher.mockImplementation(() => new Promise<Response>((resolve) => { complete = resolve }))
    fireEvent(window, new Event('focus'))
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/auth/session', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(screen.getByLabelText('選擇批次封面 ZIP')).toBe(input)
    fireEvent.change(input, { target: { files: [new File(['zip'], 'export.zip')] } })
    await screen.findByText('已載入封面 ZIP：export.zip（2 個檔案）。可以比對補封面。')
    expect((screen.getByRole('button', { name: '比對補封面' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '比對補封面' }))
    expect(fetcher).toHaveBeenCalledTimes(2)
    fireEvent.click(screen.getByRole('checkbox', { name: '確認將這批歷史資料搬入正式書庫，歧義資料分開保留' }))
    expect((screen.getByRole('button', { name: '確認批次搬遷' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => complete(Response.json({ data: { authenticated: true } })))
    expect(screen.getByLabelText('選擇批次封面 ZIP')).toBe(input)
    expect((screen.getByRole('button', { name: '比對補封面' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent(window, new Event('focus'))
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect((screen.getByRole('button', { name: '比對補封面' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => complete(Response.json({ data: { authenticated: false } })))
    expect(screen.queryByLabelText('選擇批次封面 ZIP')).toBeNull()
    expect(screen.getByLabelText('密碼')).not.toBeNull()
  } finally { vi.unstubAllGlobals() }
})
