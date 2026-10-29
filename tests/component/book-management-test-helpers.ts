import { fireEvent, screen } from '@testing-library/react'

/** Explicitly enter the same management mode a reader chooses in the UI. */
export function enterManagement(scope: '書籍' | '閱讀' | '心得') {
  const label = { 書籍: '編輯書籍資料', 閱讀: '編輯閱讀紀錄', 心得: '編輯心得' }[scope]
  const trigger = screen.queryByRole('button', { name: label })
  if (trigger) {
    fireEvent.click(trigger)
  }
}
