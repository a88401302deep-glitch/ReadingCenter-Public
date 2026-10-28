import { fireEvent, screen } from '@testing-library/react'

/** Explicitly enter the same management mode a reader chooses in the UI. */
export function enterManagement(scope: '書籍' | '閱讀' | '心得') {
  const trigger = screen.queryByRole('button', { name: `管理${scope}` })
  if (trigger) {
    fireEvent.click(trigger)
    // Section-specific tests use the tools after leaving the new full editor.
    if (scope === '書籍') fireEvent.click(screen.getByRole('button', { name: '離開書籍編輯' }))
  }
}
