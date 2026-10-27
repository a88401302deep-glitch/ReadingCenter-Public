// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import * as auditModule from '../../src/import/notion-integrity-audit'
import { NotionIntegrityAudit } from '../../src/features/import/NotionIntegrityAudit'
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('reads all four remote entity lists including deletions and never writes', async () => {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] }))
  vi.stubGlobal('fetch', request)
  render(<NotionIntegrityAudit />)
  fireEvent.click(screen.getByRole('button', { name: '核對 Notion 正式欄位' }))
  await screen.findByText(/正式 Notion 書籍 0 本/)
  expect(request).toHaveBeenCalledTimes(4)
  expect(request.mock.calls.every(([url, init]) => String(url).includes('includeDeleted=true') && !init?.method)).toBe(true)
})
it('shows a failed read rather than a false empty successful audit', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'unauthorized', message: '登入失效' } }, { status: 401 })))
  render(<NotionIntegrityAudit />)
  fireEvent.click(screen.getByRole('button', { name: '核對 Notion 正式欄位' }))
  expect((await screen.findByRole('alert')).textContent).toContain('核對未完成')
  expect(screen.queryByText(/正式 Notion 書籍 0 本/)).toBeNull()
})

it('shows missing fields and uncheckable sources immediately and groups other reasons', async () => {
  const report = auditModule.auditNotionIntegrity([], [], [], [])
  report.details = [
    { title: '缺少週期的書', field: '閱讀狀態', result: '正式欄位缺少', reason: '' },
    { title: '舊來源的書', field: '來源資料', result: '需另判定', reason: '來源格式不完整或含多列' },
    { title: '狀態不明甲', field: '閱讀狀態', result: '需另判定', reason: '原始狀態不明' },
    { title: '狀態不明乙', field: '閱讀狀態', result: '需另判定', reason: '原始狀態不明' },
  ]
  vi.spyOn(auditModule, 'auditNotionIntegrity').mockReturnValue(report)
  const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] }))
  vi.stubGlobal('fetch', request)
  render(<NotionIntegrityAudit />)
  fireEvent.click(screen.getByRole('button', { name: '核對 Notion 正式欄位' }))
  const priority = await screen.findByRole('region', { name: '優先釐清項目' })
  expect(within(priority).getByText(/缺少週期的書/).closest('details')).toBeNull()
  expect(within(priority).getByText(/舊來源的書/).closest('details')).toBeNull()
  expect(within(priority).getByText(/缺少週期的書/).textContent).toContain('原因尚未確認')
  expect(screen.getByText('閱讀狀態：需另判定；原始狀態不明（2 項）')).toBeTruthy()
  expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true)
})

it('uses an optional original CSV for read-only coverage without uploading it', async () => {
  const snapshot = { csvSha256: 'a'.repeat(64), rows: new Map() }
  vi.spyOn(auditModule, 'createNotionAuditSnapshot').mockResolvedValue(snapshot)
  const report = auditModule.auditNotionIntegrity([], [], [], [])
  report.coverage = { total: 3, present: 2, deleted: 0, missing: 1 }
  const audit = vi.spyOn(auditModule, 'auditNotionIntegrity').mockReturnValue(report)
  const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ data: [] }))
  vi.stubGlobal('fetch', request)
  const file = new File(['原文'], 'original.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'text', { value: async () => '原文' })
  render(<NotionIntegrityAudit />)
  fireEvent.change(screen.getByLabelText('原始搬遷 CSV（選填）'), { target: { files: [file] } })
  fireEvent.click(screen.getByRole('button', { name: '核對 Notion 正式欄位' }))
  await screen.findByText(/原始 CSV 共 3 列/)
  expect(audit.mock.calls.at(-1)?.[4]).toBe(snapshot)
  expect(request).toHaveBeenCalledTimes(4)
  expect(request.mock.calls.every(([, init]) => !init?.method && !init?.body)).toBe(true)
})
