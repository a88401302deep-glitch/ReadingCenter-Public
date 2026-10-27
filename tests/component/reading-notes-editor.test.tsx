// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { BookService } from '../../src/features/books/book-service'
import { ReadingContentService } from '../../src/features/reading-contents/reading-content-service'
import { ReadingNotes } from '../../src/features/library/ReadingNotes'

beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}) })
afterEach(() => vi.restoreAllMocks())

async function setup() {
 const repositories = createInMemoryRepositories()
 const book = await new BookService(repositories).create({ title: '筆記測試書', mediaTypeId: 'ebook', bookNote: '原始書目備註' })
 const service = new ReadingContentService(repositories)
 const short = await service.create(book.id, { type: 'shortReview', text: '原有短評', recordedForAt: '2026-10-10T00:00:00.000Z' })
 const long = await service.create(book.id, { type: 'longReview', title: '心得標題', text: '長篇原文' })
 const changed = vi.fn()
 const view = render(<ReadingNotes books={[book]} service={service} revision={0} onChanged={changed} onOpenBook={vi.fn()} />)
 await screen.findByText('原有短評')
 return { repositories, book, service, short, long, changed, view }
}

const shortCard = () => screen.getByText('原有短評').closest('li')!
function openShort() {
 const trigger = within(shortCard()).getByRole('button', { name: '編輯' })
 trigger.focus()
 fireEvent.click(trigger)
 return trigger
}

it('edits in a dialog, preserves filters and relations, then restores the original control without scrolling', async () => {
 const { repositories, book, short, long, changed } = await setup()
 fireEvent.change(screen.getByRole('searchbox'), { target: { value: '原有' } })
 fireEvent.change(screen.getByLabelText('依內容類型篩選'), { target: { value: 'shortReview' } })
 const trigger = openShort()
 expect(trigger.closest('.note-card-cover')).toBeTruthy()
 expect(trigger.textContent).toBe('')
 const dialog = screen.getByRole('dialog', { name: '編輯短評' })
 expect(document.querySelector('.reading-notes .notes-edit-form')).toBeNull()
 fireEvent.change(within(dialog).getByLabelText('內容'), { target: { value: '原有短評已修改' } })
 fireEvent.click(within(dialog).getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(screen.getByText('原有短評已修改')).toBeTruthy()
 await waitFor(() => expect(document.activeElement).toBe(trigger))
 await waitFor(() => expect(window.scrollTo).toHaveBeenCalledWith(0, 0))
 expect(screen.getByRole('searchbox')).toHaveProperty('value', '原有')
 expect(screen.getByLabelText('依內容類型篩選')).toHaveProperty('value', 'shortReview')
 expect(await repositories.readingContents.getById(short.id)).toMatchObject({ text: '原有短評已修改', revision: 2, createdAt: short.createdAt, recordedForAt: short.recordedForAt, cycleId: short.cycleId, readingRecordId: short.readingRecordId })
 expect(await repositories.readingContents.getById(long.id)).toEqual(long)
 expect(await repositories.books.getById(book.id)).toEqual(book)
 expect(changed).toHaveBeenCalledOnce()
})

it('retains an unsaved draft when cancellation is declined and discards only after confirmation', async () => {
 const { repositories, short, changed } = await setup()
 const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
 const trigger = openShort(), dialog = screen.getByRole('dialog')
 fireEvent.change(within(dialog).getByLabelText('內容'), { target: { value: '尚未儲存' } })
 fireEvent.click(within(dialog).getByRole('button', { name: '取消' }))
 expect(within(dialog).getByLabelText('內容')).toHaveProperty('value', '尚未儲存')
 fireEvent.keyDown(document, { key: 'Escape' })
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 await waitFor(() => expect(document.activeElement).toBe(trigger))
 expect(confirm).toHaveBeenCalledTimes(2)
 expect(await repositories.readingContents.getById(short.id)).toEqual(short)
 expect(changed).not.toHaveBeenCalled()
})

it('keeps long-review title and text in the dialog after a revision conflict', async () => {
 const { service, long, changed } = await setup()
 const card = screen.getByText('長篇原文').closest('li')!
 fireEvent.click(within(card).getByRole('button', { name: '編輯' }))
 const dialog = screen.getByRole('dialog', { name: '編輯長篇心得' })
 fireEvent.change(within(dialog).getByLabelText('標題'), { target: { value: '本機草稿標題' } })
 fireEvent.change(within(dialog).getByLabelText('內容'), { target: { value: '本機草稿內容' } })
 await service.update(long.id, { type: 'longReview', title: '其他裝置標題', text: '其他裝置內容' }, long.revision)
 fireEvent.click(within(dialog).getByRole('button', { name: '儲存' }))
 expect((await within(dialog).findByRole('alert')).textContent).toContain('資料已有新版本')
 expect(within(dialog).getByLabelText('標題')).toHaveProperty('value', '本機草稿標題')
 expect(within(dialog).getByLabelText('內容')).toHaveProperty('value', '本機草稿內容')
 expect(changed).not.toHaveBeenCalled()
})

it('prevents duplicate submission and closing while a save is pending', async () => {
 const { service, short } = await setup()
 let finish!: () => void
 const gate = new Promise<void>(resolve => { finish = resolve })
 const original = service.update.bind(service)
 const update = vi.spyOn(service, 'update').mockImplementation(async (id, draft, revision) => { await gate; return original(id, draft, revision) })
 const confirm = vi.spyOn(window, 'confirm')
 openShort()
 const dialog = screen.getByRole('dialog'), form = dialog.querySelector('form')!
 fireEvent.change(within(dialog).getByLabelText('內容'), { target: { value: '等待儲存' } })
 fireEvent.submit(form)
 fireEvent.submit(form)
 expect(update).toHaveBeenCalledOnce()
 expect(within(dialog).getByRole('button', { name: '儲存中…' })).toHaveProperty('disabled', true)
 fireEvent.keyDown(document, { key: 'Escape' })
 expect(screen.getByRole('dialog')).toBe(dialog)
 expect(confirm).not.toHaveBeenCalled()
 await act(async () => { finish(); await gate })
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect((await service.listAll()).find(item => item.id === short.id)?.revision).toBe(2)
})

it('requires explicit deletion, retains errors for retry, and never deletes the book', async () => {
 const { repositories, book, service, short, changed } = await setup()
 const button = within(shortCard()).getByRole('button', { name: '刪除' })
 fireEvent.click(button)
 expect(await repositories.readingContents.getById(short.id)).toEqual(short)
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
 expect(screen.queryByRole('dialog')).toBeNull()
 fireEvent.click(button)
 const remove = vi.spyOn(service, 'delete').mockRejectedValueOnce(new Error('暫時無法刪除'))
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' }))
 expect((await screen.findByRole('alert')).textContent).toContain('暫時無法刪除')
 expect(await repositories.readingContents.getById(short.id)).toEqual(short)
 expect(changed).not.toHaveBeenCalled()
 fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '確認刪除' }))
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(remove).toHaveBeenCalledTimes(2)
 expect(await repositories.readingContents.getById(short.id)).toBeUndefined()
 expect(await repositories.books.getById(book.id)).toEqual(book)
 await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('searchbox')))
})

it('preserves highlight annotations and dates when editing from its dialog', async () => {
 const { repositories, book, service, changed, view } = await setup()
 const highlight = await service.create(book.id, { type: 'highlight', text: '畫線原文', note: '原附註', locator: '第七頁', recordedForAt: '2026-10-11T00:00:00.000Z' })
 // A parent refresh reuses the component and keeps its controls.
 view.rerender(<ReadingNotes books={[book]} service={service} revision={1} onChanged={changed} onOpenBook={vi.fn()} />)
 const scope = within(view.container)
 fireEvent.change(scope.getByLabelText('依內容類型篩選'), { target: { value: 'highlight' } })
 const card = (await scope.findByText('畫線原文')).closest('li')!
 fireEvent.click(within(card).getByRole('button', { name: '編輯' }))
 const dialog = screen.getByRole('dialog', { name: '編輯畫線' })
 fireEvent.change(within(dialog).getByLabelText('內容'), { target: { value: '畫線修改' } })
 fireEvent.click(within(dialog).getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
 expect(await repositories.readingContents.getById(highlight.id)).toMatchObject({ text: '畫線修改', note: '原附註', locator: '第七頁', recordedForAt: highlight.recordedForAt })
})
