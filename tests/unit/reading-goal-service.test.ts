import { expect, it } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { saveReadingGoal } from '../../src/features/reading-overview/reading-goal-service'
import { assertValidReadingGoal, createMetadata } from '../../src/domain'
const now = '2026-10-04T00:00:00.000Z'
it('keeps independent periods, rejects stale edits and clears without losing revisions', async () => {
  const repositories = createInMemoryRepositories()
  const month = await saveReadingGoal(repositories, '2026-10', 1500, 0, now)
  const year = await saveReadingGoal(repositories, '2026', 18000, 0, now)
  await expect(saveReadingGoal(repositories, '2026-10', 100, 0, now)).rejects.toThrow('新版本')
  const cleared = await saveReadingGoal(repositories, '2026-10', null, 1, now)
  expect(cleared).toMatchObject({ createdAt: month.createdAt, targetMinutes: null, revision: 2 })
  expect(await repositories.readingGoals.getById(year.id)).toEqual(year)
  expect(await repositories.readingGoals.getById('reading-goal:2026-11')).toBeUndefined()
})
it('rejects malformed periods, mismatched identities and invalid minutes', () => {
  const base = { ...createMetadata({ id: 'reading-goal:2026-10', now }), period: '2026-10', targetMinutes: 60 }
  for (const changes of [{ period: '2026-13' }, { id: 'another' }, { targetMinutes: 0 }, { targetMinutes: -1 }, { targetMinutes: 1.2 }, { targetMinutes: Number.MAX_SAFE_INTEGER + 1 }]) expect(() => assertValidReadingGoal({ ...base, ...changes })).toThrow()
})

it('stores annual book targets independently of duration targets and rejects stale or invalid changes', async () => {
  const { saveAnnualBookGoal } = await import('../../src/features/reading-overview/reading-goal-service')
  const repositories = createInMemoryRepositories()
  const year = await saveReadingGoal(repositories, '2026', 18000, 0, now)
  const changed = await saveAnnualBookGoal(repositories, '2026', 70, year.revision, now)
  expect(changed).toMatchObject({ targetBooks: 70, targetMinutes: 18000, revision: 2 })
  await expect(saveAnnualBookGoal(repositories, '2026', 80, year.revision, now)).rejects.toThrow('新版本')
  for (const target of [0, -1, 1.5, Infinity]) await expect(saveAnnualBookGoal(repositories, '2027', target, 0, now)).rejects.toThrow()
  await expect(saveAnnualBookGoal(repositories, '2026-10', 70, 0, now)).rejects.toThrow('年度')
  const timeChanged = await saveReadingGoal(repositories, '2026', 19000, 2, now)
  expect(timeChanged.targetBooks).toBe(70)
  expect(await repositories.books.getAll()).toHaveLength(0)
})
