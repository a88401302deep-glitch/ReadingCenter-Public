// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from '../../src/shared/ui/Modal'

describe('Modal', () => {
  it('keeps Tab and Shift+Tab inside an opted-in dialog', () => {
    render(<Modal trapFocus onClose={vi.fn()} open title="閱讀筆記"><input aria-label="內容" /><button type="button">儲存</button></Modal>)
    const close = screen.getByRole('button', { name: '關閉' }), save = screen.getByRole('button', { name: '儲存' })
    act(() => save.focus())
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(save)
  })

  it('keeps input focus during edits and restores prior focus without scrolling on close', () => {
    const previous = document.createElement('button')
    document.body.append(previous)
    previous.focus()
    const focus = vi.spyOn(previous, 'focus')
    const onClose = vi.fn()
    const view = render(<Modal onClose={onClose} open title="編輯書籍"><input aria-label="測試欄位" /></Modal>)
    const input = screen.getByLabelText('測試欄位')
    act(() => input.focus())
    view.rerender(<Modal hasUnsavedChanges onClose={() => {}} open title="編輯書籍"><input aria-label="測試欄位" /></Modal>)
    expect(document.activeElement).toBe(input)
    view.rerender(<Modal onClose={onClose} open={false} title="編輯書籍">內容</Modal>)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(document.activeElement).toBe(previous)
    focus.mockRestore()
    previous.remove()
  })

  it.each([
    ['closeButton', () => fireEvent.click(screen.getByRole('button', { name: '關閉' }))],
    ['escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    ['backdrop', () => fireEvent.mouseDown(screen.getByTestId('modal-backdrop'))]
  ] as const)('closes by %s', (reason, close) => {
    const onClose = vi.fn()
    render(<Modal onClose={onClose} open title="編輯書籍">內容</Modal>)
    close()
    expect(onClose).toHaveBeenCalledWith(reason)
  })

  it('can block closing when unsaved changes are not discarded', () => {
    const onClose = vi.fn()
    const confirmDiscard = vi.fn(() => false)
    render(
      <Modal confirmDiscard={confirmDiscard} hasUnsavedChanges onClose={onClose} open title="編輯書籍">
        內容
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(confirmDiscard).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
  })
})
