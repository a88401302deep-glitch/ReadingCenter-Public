// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { createMetadata } from '../../src/domain'
import { ReadingGoals } from '../../src/features/reading-overview/ReadingGoals'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'
import { saveReadingGoal } from '../../src/features/reading-overview/reading-goal-service'
import type { ReadingStatisticsData } from '../../src/features/reading-overview/reading-statistics'
afterEach(cleanup)
const now = '2026-10-04T00:00:00.000Z'
const data: ReadingStatisticsData = { currentMonth: '2026-10', categoryNames: {}, undatedCompletions: 1, days: [{ date: '2026-10-02', minutes: 90, knownRecords: 1, unknownRecords: 2, entries: [], reading: true }] }
it('shows actual progress above 100%, counts unknown separately, saves and rejects stale drafts', async () => {
  const repositories = createInMemoryRepositories()
  const goal = await saveReadingGoal(repositories, '2026-10', 60, 0, now)
  const service = new ReadingOverviewService(repositories, () => new Date(now))
  const changed = async () => { view.rerender(<ReadingGoals data={data} goals={await repositories.readingGoals.getAll()} service={service} onChanged={changed} />) }
  const view = render(<ReadingGoals data={data} goals={[goal]} service={service} onChanged={changed} />)
  const card = screen.getByRole('region', { name: '2026-10 月閱讀目標' })
  expect(within(card).getByText('150%，已達成')).not.toBeNull()
  expect(within(card).getByRole('progressbar').getAttribute('value')).toBe('60')
  expect(within(card).getByText('另有 2 筆閱讀紀錄未記錄時長。')).not.toBeNull()
  fireEvent.click(within(card).getByRole('button', { name: '設定月閱讀目標' }))
  fireEvent.change(within(card).getByLabelText('月閱讀目標時數'), { target: { value: '2' } })
  await saveReadingGoal(repositories, '2026-10', 180, 1, now)
  await changed()
  fireEvent.click(within(card).getByRole('button', { name: '儲存目標' }))
  await waitFor(() => expect(within(card).getByRole('alert').textContent).toContain('新版本'))
  expect((within(card).getByLabelText('月閱讀目標時數') as HTMLInputElement).value).toBe('2')
  fireEvent.click(within(card).getByRole('button', { name: '取消' }))
  fireEvent.click(within(card).getByRole('button', { name: '設定月閱讀目標' }))
  fireEvent.change(within(card).getByLabelText('月閱讀目標時數'), { target: { value: '2' } })
  fireEvent.click(within(card).getByRole('button', { name: '儲存目標' }))
  await waitFor(() => expect(within(card).queryByLabelText('月閱讀目標時數')).toBeNull())
  expect(within(card).getByText('75%')).not.toBeNull()
  fireEvent.change(screen.getByLabelText('目標月份'), { target: { value: '2026-11' } })
  expect(within(screen.getByRole('region', { name: '2026-11 月閱讀目標' })).getByText('尚未設定目標')).not.toBeNull()
})
it('accepts partially entered years without forcing the previous value', () => {
  const service = new ReadingOverviewService(createInMemoryRepositories())
  render(<ReadingGoals data={data} goals={[{ ...createMetadata({ id: 'reading-goal:2026', now }), period: '2026', targetMinutes: null }]} service={service} onChanged={async () => {}} />)
  fireEvent.change(screen.getByLabelText('目標年度'), { target: { value: '202' } })
  expect((screen.getByLabelText('目標年度') as HTMLInputElement).value).toBe('202')
  expect(screen.queryByRole('region', { name: '202 月閱讀目標' })).toBeNull()
})
