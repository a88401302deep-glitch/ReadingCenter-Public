import { describe, expect, it } from 'vitest'
import { combineMoonStatistics, parseMoonDays } from '../../src/import/moon-statistics'
const stat = (path: string, value: string) => ({ path, days: parseMoonDays(value), durationMs: 1000, readWords: 10 })
describe('Moon source aggregates', () => {
  it('retains exact duration, raw day and completion progress without inventing timestamps', () => {
    expect(parseMoonDays('123|966889@1511 #100%\n')).toEqual([{ dayCode: 123, durationMs: 966889, readWords: 1511, progressPercent: 100 }])
  })
  it('rejects malformed, duplicate-day and unsafe values', () => {
    for (const raw of ['1|2@3 #101%', '1|2@3 #0%\n1|2@3 #0%', 'x', '1|9007199254740992@3 #0%']) expect(() => parseMoonDays(raw)).toThrow()
  })
  it('adds independent devices and repeated chapter reading', () => {
    const statistics = [stat('/book.epub', '1|1000@10 #50%')]
    expect(combineMoonStatistics([{ deviceId: 'one', statistics }, { deviceId: 'two', statistics }]).durationMs).toBe(2000)
  })
  it('deduplicates identical same-device snapshots', () => {
    const snapshot = { deviceId: 'one', statistics: [stat('/book.epub', '1|1000@10 #50%')] }
    expect(combineMoonStatistics([snapshot, snapshot])).toMatchObject({ durationMs: 1000, readWords: 10, duplicateDays: 1 })
  })
  it('preserves same-name paths and old-only days', () => {
    const result = combineMoonStatistics([{ deviceId: 'one', statistics: [stat('/old/book.epub', '1|1000@10 #50%')] }, { deviceId: 'one', statistics: [stat('/new/book.epub', '1|1000@10 #50%'), stat('/old/book.epub', '2|2000@20 #100%')] }])
    expect(result.durationMs).toBe(4000)
  })
  it('blocks totals when same-device daily values conflict', () => {
    const result = combineMoonStatistics([{ deviceId: 'one', statistics: [stat('/book', '1|1000@10 #50%')] }, { deviceId: 'one', statistics: [stat('/book', '1|2000@20 #100%')] }])
    expect(result).toMatchObject({ conflictCount: 1, durationMs: null, readWords: null })
  })
})
