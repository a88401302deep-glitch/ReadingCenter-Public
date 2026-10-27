// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createMetadata, defaultMonthColors, readingPreferencesId } from '../../src/domain'
import { MonthColorSettings } from '../../src/features/reading-overview/MonthColorSettings'
afterEach(cleanup)
const value = { ...createMetadata({ id: readingPreferencesId, now: '2026-10-04T00:00:00.000Z' }), monthColors: [...defaultMonthColors] }
it('preserves a draft across remote updates, rejects stale saves and resets only after save', async () => {
  const onSave = vi.fn().mockRejectedValue(new Error('配色已有新版本'))
  const view = render(<MonthColorSettings value={value} onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: '編輯月份配色' }))
  fireEvent.change(screen.getByLabelText('2 月配色'), { target: { value: '#000000' } })
  view.rerender(<MonthColorSettings value={{ ...value, revision: 2 }} onSave={onSave} />)
  fireEvent.click(screen.getByRole('button', { name: '儲存配色' }))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('新版本'))
  expect(onSave).toHaveBeenCalledWith(expect.arrayContaining(['#000000']), 1)
  expect((screen.getByLabelText('2 月配色') as HTMLInputElement).value).toBe('#000000')
  fireEvent.click(screen.getByRole('button', { name: '取消配色編輯' }))
  onSave.mockResolvedValue(undefined)
  fireEvent.click(screen.getByRole('button', { name: '編輯月份配色' }))
  fireEvent.change(screen.getByLabelText('2 月配色'), { target: { value: '#ffffff' } })
  fireEvent.click(screen.getByRole('button', { name: '還原預設色' }))
  expect(onSave).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '儲存配色' }))
  await waitFor(() => expect(screen.queryByLabelText('2 月配色')).toBeNull())
  expect(onSave).toHaveBeenLastCalledWith([...defaultMonthColors], 2)
})
