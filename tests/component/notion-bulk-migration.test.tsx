// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotionReviewQueue } from '../../src/features/import/NotionReviewQueue'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { createInMemoryRepositories } from '../../src/data'

vi.mock('../../src/features/auth/auth-context', () => ({ useAuth: () => ({ authEnabled: true }) }))
vi.mock('../../src/import/notion-reimport-check', async (original) => ({
  ...await original<typeof import('../../src/import/notion-reimport-check')>(),
  checkNotionWorkCollisionsInRemote: vi.fn().mockResolvedValue({ groups: [] })
}))
afterEach(() => vi.unstubAllGlobals())

describe('bulk migration entry', () => {
  it('allows one confirmation with unresolved rows and no separately uploaded pairing plan', async () => {
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview('書名,作者,閱讀,評分,主題,標籤,時間,一行心得\n測試,,閱讀中,,,,2024/02/25,來源短評'))
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ data: { status: 'inserted' } }, { status: 201 }))
    vi.stubGlobal('fetch', request)
    render(<NotionReviewQueue rows={rows} csvSha256={'a'.repeat(64)} repositories={createInMemoryRepositories()} />)
    const button = screen.getByRole('button', { name: '確認批次搬遷' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByLabelText('確認將這批歷史資料搬入正式書庫，歧義資料分開保留'))
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await screen.findByText(/本次搬遷結束：新增 1 組/)
    expect(request).toHaveBeenCalledTimes(1)
    const body = JSON.parse(request.mock.calls[0][1]!.body as string)
    expect(body.items.find((item: { kind: string }) => item.kind === 'readingCycle').entity).toMatchObject({ status: 'reading', completionDate: null })
    expect(body.items.find((item: { kind: string }) => item.kind === 'book').entity.importSourceNotes).toContain('2024/02/25')
    expect(body.items.find((item: { kind: string }) => item.kind === 'book').entity.bookNote).toBe('')
    expect(screen.getByRole('button', { name: '下載搬遷結果' })).toBeTruthy()
  })
})
