// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { BookForm } from '../../src/features/books/BookForm'

afterEach(cleanup)

it('stores a pasted multiline title as one line while preserving separate author names', async () => {
 const user = userEvent.setup(), save = vi.fn(async () => undefined)
 render(<BookForm onSubmit={save} onCancel={vi.fn()} />)
 const title = screen.getByLabelText('出版書名')
 await user.click(title)
 await user.paste('第一行\r\n第二行\n第三行\u2028第四行')
 expect(title).toHaveProperty('value', '第一行 第二行 第三行 第四行')
 await user.keyboard('{Enter}')
 expect(title).toHaveProperty('value', '第一行 第二行 第三行 第四行')
 expect(save).not.toHaveBeenCalled()
 const authors = screen.getByLabelText('作者（每行一位）')
 await user.click(authors)
 await user.paste('作者甲\n作者乙')
 expect(authors).toHaveProperty('value', '作者甲\n作者乙')
 await user.click(screen.getByRole('button', { name: '儲存' }))
 await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: '第一行 第二行 第三行 第四行', authorNames: ['作者甲', '作者乙'] })))
})

it('allows IME confirmation but prevents an ordinary Enter in the title', () => {
 render(<BookForm onSubmit={vi.fn()} onCancel={vi.fn()} />)
 const title = screen.getByLabelText('出版書名')
 expect(fireEvent.keyDown(title, { key: 'Enter', isComposing: true })).toBe(true)
 expect(fireEvent.keyDown(title, { key: 'Enter', keyCode: 229 })).toBe(true)
 expect(fireEvent.keyDown(title, { key: 'Enter' })).toBe(false)
 expect(fireEvent.keyDown(screen.getByLabelText('作者（每行一位）'), { key: 'Enter' })).toBe(true)
})
