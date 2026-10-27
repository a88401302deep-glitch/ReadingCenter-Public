import { expect, it } from 'vitest'
import { buildYearHeatmap, heatmapDescription, heatmapLevel, heatmapTextColor } from '../../src/features/reading-overview/reading-heatmap'
import type { ReadingStatisticsData } from '../../src/features/reading-overview/reading-statistics'
const data: ReadingStatisticsData = { currentMonth: '2024-02', days: [], undatedCompletions: 1, categoryNames: {} }
it('lays out complete leap and ordinary years in Monday-first weeks, including 54-week years', () => {
  const leap = buildYearHeatmap(data, 2024)
  expect(leap.days).toHaveLength(366)
  expect(leap.days[59].date).toBe('2024-02-29')
  expect(leap.days.at(-1)?.date).toBe('2024-12-31')
  expect(leap.weeks[0][0]?.date).toBe('2024-01-01')
  expect(leap.monthWeeks).toHaveLength(12)
  const ordinary = buildYearHeatmap(data, 2023)
  expect(ordinary.days).toHaveLength(365)
  expect(ordinary.weeks[0].slice(0, 6)).toEqual(Array(6).fill(null))
  expect(ordinary.weeks[0][6]?.date).toBe('2023-01-01')
  expect(buildYearHeatmap(data, 2012).weeks).toHaveLength(54)
  expect(buildYearHeatmap(data, 9999).days.at(-1)?.date).toBe('9999-12-31')
})
it('uses completed-book count bands independently of recorded minutes', () => {
  expect([0, 1, 2, 3, 4, 10].map(heatmapLevel)).toEqual([0, 1, 2, 3, 4, 4])
  expect(heatmapDescription()).toBe('完讀 0 本')
  const day = { date: '2024-02-29', minutes: 0, knownRecords: 0, unknownRecords: 0, entries: [], reading: false }
  expect(heatmapDescription(day)).toBe('完讀 0 本')
  expect(heatmapDescription({ ...day, knownRecords: 1 })).toBe('完讀 0 本')
  expect(heatmapDescription({ ...day, minutes: 30, knownRecords: 1, unknownRecords: 1 })).toBe('完讀 0 本')
  expect(heatmapTextColor('#000000', 70)).toBe('#ffffff')
  expect(heatmapTextColor('#ffffff', 70)).toBe('#000000')
})
