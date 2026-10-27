// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { File as NodeFile } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { expect, it, vi } from 'vitest'
import { createSyncingIndexedDbRepositories } from '../../src/data'
import { importSpreadsheet, planSpreadsheet, readSpreadsheet } from '../../src/features/import/spreadsheet-books'
import { ReadingOverviewService } from '../../src/features/reading-overview/reading-overview-service'

it('imports metadata and undated completion once, queues sync, and never overwrites a matching title', async () => {
 const local = createSyncingIndexedDbRepositories('sheet-'+crypto.randomUUID())
 try {
  const preview = planSpreadsheet([['書名','作者','出版社','閱讀狀態','分類','來源','短評'],['書甲','作者甲','出版甲','已完讀','小說','讀墨','我的想法'],['書乙','','','閱讀中','','','']])
  expect(await importSpreadsheet(local.repositories,preview)).toEqual({added:2,skipped:0})
  const before = await local.repositories.books.getAll(), outbox = await local.outbox.getAll()
  expect(before).toHaveLength(2); expect(outbox.length).toBeGreaterThan(2)
  expect(await local.repositories.readingRecords.getAll()).toHaveLength(0)
  expect((await local.repositories.readingCycles.getAll()).find(c=>c.status==='completed')).toMatchObject({completionDate:null,finishedAt:null})
  expect((await local.repositories.readingContents.getAll())[0].text).toBe('我的想法')
  const changed = planSpreadsheet([['書名','作者'],['書甲','不應覆寫']])
  expect(await importSpreadsheet(local.repositories,changed)).toEqual({added:0,skipped:1})
  expect(await local.repositories.books.getAll()).toEqual(before)
  expect(await local.outbox.getAll()).toEqual(outbox)
 } finally { await local.deleteDatabase() }
})
it('validates all rows before writes and rolls back destination errors including the sync outbox', async () => {
 const local = createSyncingIndexedDbRepositories('sheet-rollback-'+crypto.randomUUID())
 try {
  const invalid = planSpreadsheet([['書名','ISBN'],['有效書',''],['錯誤書','INVALID']])
  await expect(importSpreadsheet(local.repositories,invalid)).rejects.toThrow('ISBN')
  expect(await local.repositories.books.getAll()).toHaveLength(0)
  expect(await local.outbox.getAll()).toHaveLength(0)
  const valid = planSpreadsheet([['書名'],['第一本'],['第二本']])
  const original = local.repositories.books.save.bind(local.repositories.books); let count=0
  vi.spyOn(local.repositories.books,'save').mockImplementation(async book=>{if(++count===2)throw new Error('synthetic failure');return original(book)})
  await expect(importSpreadsheet(local.repositories,valid)).rejects.toThrow('synthetic failure')
  expect(await local.repositories.books.getAll()).toHaveLength(0)
  expect(await local.outbox.getAll()).toHaveLength(0)
 } finally { await local.deleteDatabase() }
})
it('reads XLSX shared strings and keeps completion without a guessed date', async () => {
 const file = new NodeFile([Buffer.from(readFileSync(`${process.cwd()}/tests/fixtures/journal-books.xlsx.b64`, 'utf8'), 'base64')],'books.xlsx')
 const preview = await readSpreadsheet(file as unknown as File)
 expect(preview.rows[0]).toMatchObject({draft:{title:'Excel 合成書目'},status:'completed',completedOn:null})
})
it('rejects contradictory completion dates and reports extra columns for review', () => {
 expect(()=>planSpreadsheet([['書名','閱讀狀態','完讀日期'],['書甲','待讀','2026-10-01']])).toThrow('核對')
 expect(()=>planSpreadsheet([['書名','完讀日期'],['書甲','2026-02-30']])).toThrow('YYYY-MM-DD')
 expect(planSpreadsheet([['書名','未支援'],['書甲','內容']]).extraColumns).toEqual(['未支援'])
})
it('shows a completed imported book as full progress without manufacturing reading records', async () => {
 const local = createSyncingIndexedDbRepositories('sheet-progress-'+crypto.randomUUID())
 try {
  await importSpreadsheet(local.repositories,planSpreadsheet([['書名','完讀日期'],['完讀書','2026-10-01']]))
  expect((await new ReadingOverviewService(local.repositories).getOverview()).recentBooks[0].progress).toEqual({unit:'percent',value:100})
  expect(await local.repositories.readingRecords.getAll()).toHaveLength(0)
 } finally {await local.deleteDatabase()}
})
