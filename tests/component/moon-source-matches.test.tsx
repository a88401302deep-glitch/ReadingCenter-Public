// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { createInMemoryRepositories } from '../../src/data'
import { createMetadata, sourceDayDate, type SourceReadingDay } from '../../src/domain'
import { BookService } from '../../src/features/books/book-service'
import { MoonSourceMatches } from '../../src/features/import/MoonSourceMatches'

it('requires an explicit selection and exposes author differences before saving a source group', async () => {
  const repositories = createInMemoryRepositories()
  const metadata = (id: string) => createMetadata({ id, now: '2026-10-08T00:00:00Z' })
  await repositories.dictionaries.save({ ...metadata('author-one'), kind: 'author', name: '作者一', aliases: [], color: null })
  await repositories.dictionaries.save({ ...metadata('author-two'), kind: 'author', name: '作者二', aliases: [], color: null })
  for (const id of ['one', 'two']) {
    const book = await new BookService(repositories, () => id).create({ title: '示範書籍', mediaTypeId: 'ebook' })
    await repositories.books.save({ ...book, authorIds: ['author-' + id] })
  }
  const row: SourceReadingDay = { ...metadata('source-day'), source: 'moon', deviceId: '裝置一', sourcePath: '/示範書籍.txt', sourceTitle: '示範書籍', backupName: 'test.mrpro', dayCode: 20697, date: sourceDayDate(20697), durationMs: 60000, readWords: 30, progressPercent: 100, bookId: null, completionDisputed: false }
  await repositories.sourceReadingDays.save(row)
  const onSaved = vi.fn().mockResolvedValue(undefined), user = userEvent.setup()
  render(<MoonSourceMatches rows={[row]} repositories={repositories} onSaved={onSaved} />)
  await user.click(screen.getByText(/示範書籍 · 裝置一 · 1 列/))
  await screen.findByRole('option', { name: '示範書籍 · 作者二' })
  const select = screen.getByRole('combobox', { name: '正式書籍' })
  expect(select).toHaveProperty('value', '')
  expect(screen.getByRole('button', { name: '保存書籍配對' })).toHaveProperty('disabled', true)
  await user.selectOptions(select, 'two')
  await user.click(screen.getByRole('button', { name: '保存書籍配對' }))
  await screen.findByText(/已更新 1 列來源配對/)
  expect(onSaved).toHaveBeenCalledOnce()
  expect(await repositories.sourceReadingDays.getById(row.id)).toMatchObject({ bookId: 'two', readWords: 30, progressPercent: 100 })
  expect(await repositories.readingCycles.getAll()).toEqual([])
})


it('defaults to pending groups, identifies mixed and deleted links, and lets users inspect all matched sources', async () => {
  const repositories = createInMemoryRepositories()
  const one = await new BookService(repositories, () => 'one').create({ title: '書一', mediaTypeId: 'ebook' })
  const two = await new BookService(repositories, () => 'two').create({ title: '書二', mediaTypeId: 'ebook' })
  const row = (id: string, title: string, bookId: string | null): SourceReadingDay => ({ ...createMetadata({ id, now: '2026-10-12T00:00:00Z' }), source: 'moon', deviceId: '裝置', sourcePath: '/'+title+'.txt', sourceTitle: title, backupName: 'backup.mrpro', dayCode: 20697, date: sourceDayDate(20697), durationMs: 600000, readWords: 100, progressPercent: 50, bookId, completionDisputed: false })
  const rows = [row('linked', '已配對來源', one.id), row('unmatched', '未配對來源', null), row('mixed-a', '混合來源', one.id), row('mixed-b', '混合來源', two.id), row('partial-a', '部分來源', one.id), row('partial-b', '部分來源', null), row('deleted', '已刪書來源', 'missing')]
  for(const item of rows) await repositories.sourceReadingDays.save(item)
  const user = userEvent.setup()
  render(<MoonSourceMatches rows={rows} repositories={repositories} onSaved={vi.fn()} />)
  await screen.findByRole('option', { name: '待處理（4 組）' })
  expect(screen.queryByText(/已配對來源 · 裝置/)).toBeNull()
  expect(screen.getByText(/混合來源 · 裝置/).textContent).toContain('需重新核對')
  expect(screen.getByText(/已刪書來源 · 裝置/).textContent).toContain('需重新核對')
  expect(screen.getByText(/部分來源 · 裝置/).textContent).toContain('部分配對')
  await user.selectOptions(screen.getByRole('combobox', { name: '配對範圍' }), 'linked')
  expect(screen.getByText(/已配對來源 · 裝置/)).not.toBeNull()
  expect(screen.queryByText(/未配對來源 · 裝置/)).toBeNull()
  await user.selectOptions(screen.getByRole('combobox', { name: '配對範圍' }), 'all')
  expect(screen.getByText(/未配對來源 · 裝置/)).not.toBeNull()
  expect(await repositories.sourceReadingDays.getAll()).toHaveLength(7)
})
