// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { BookMetadataDialog } from '../../src/features/books/BookMetadataDialog'
import { BookMetadataSearch } from '../../src/features/books/BookMetadataSearch'

it('keeps query edits across reopening and returns focus and field scroll without submitting the book', () => {
 const submit = vi.fn(), escape = vi.fn()
 render(<form onSubmit={submit} onKeyDown={escape}><div className="book-form-fields"><BookMetadataDialog><label>測試查詢<input defaultValue="原書名" /></label></BookMetadataDialog></div></form>)
 const trigger = screen.getByRole('button', { name: '搜尋並補全書籍資料' })
 const fields = trigger.closest('.book-form-fields') as HTMLElement
 fields.scrollTop = 123
 fireEvent.click(trigger)
 const dialog = screen.getByRole('dialog', { name: '書目查詢與核對' })
 fireEvent.change(within(dialog).getByLabelText('測試查詢'), { target: { value: '修正書名' } })
 fields.scrollTop = 0
 fireEvent.keyDown(dialog, { key: 'Escape' })
 expect(screen.queryByRole('dialog')).toBeNull()
 expect(document.activeElement).toBe(trigger)
 expect(fields.scrollTop).toBe(123)
 expect(escape).not.toHaveBeenCalled()
 expect(submit).not.toHaveBeenCalled()
 fireEvent.click(trigger)
 expect(screen.getByLabelText('測試查詢')).toHaveProperty('value', '修正書名')
 fireEvent.click(screen.getByRole('button', { name: '返回編輯表單' }))
 expect(screen.queryByRole('dialog')).toBeNull()
})

it('does not dismiss the lookup when the parent is saving', () => {
 const view = render(<BookMetadataDialog><p>候選核對</p></BookMetadataDialog>)
 fireEvent.click(screen.getByRole('button', { name: '搜尋並補全書籍資料' }))
 view.rerender(<BookMetadataDialog disabled><p>候選核對</p></BookMetadataDialog>)
 const dialog = screen.getByRole('dialog', { name: '書目查詢與核對' })
 fireEvent.keyDown(dialog, { key: 'Escape' })
 expect(screen.getByRole('dialog')).toBe(dialog)
 expect(screen.getByRole('button', { name: '返回編輯表單' })).toHaveProperty('disabled', true)
})

it('offers a browser search with the current title safely encoded without applying metadata', () => {
 const select = vi.fn()
 render(<BookMetadataDialog><BookMetadataSearch embeddedInDialog title="櫻花 & 書名？" author="作者甲" disabled={false} onSelect={select} /></BookMetadataDialog>)
 fireEvent.click(screen.getByRole('button', { name: '搜尋並補全書籍資料' }))
 const link = screen.getByRole('link', { name: '網頁搜尋書籍資料' })
 const url = new URL(link.getAttribute('href')!)
 expect(url.origin).toBe('https://www.google.com')
 expect(url.searchParams.get('q')).toBe('櫻花 & 書名？ 作者甲 書籍 出版社')
 expect(link.getAttribute('target')).toBe('_blank')
 expect(link.getAttribute('rel')).toBe('noopener noreferrer')
 expect(select).not.toHaveBeenCalled()
})
