import {
  createNotionImportPreview,
  parseNotionCsv,
  type NotionFieldMapping,
  type NotionImportPreview,
  type NotionImportPreviewRow
} from './notion-csv'

export const READING_CENTER_NOTION_MAPPING = {
  title: '書名',
  creator: '作者',
  status: '閱讀',
  rating: '評分',
  categories: '主題',
  tags: '標籤',
  readDates: '時間',
  shortReview: '一行心得'
} as const satisfies NotionFieldMapping

export function createReadingCenterNotionPreview(csv: string): NotionImportPreview {
  return createNotionImportPreview(parseNotionCsv(csv), READING_CENTER_NOTION_MAPPING)
}

export function selectRepresentativeNotionPreviewRows(
  preview: NotionImportPreview,
  limit = 20
): NotionImportPreviewRow[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new RangeError('Notion preview sample limit must be an integer from 1 to 20')
  }

  const selected = new Map<number, NotionImportPreviewRow>()
  const bySourceKey = new Map<string, NotionImportPreviewRow[]>()
  for (const row of preview.rows) {
    const group = bySourceKey.get(row.sourceKey) ?? []
    group.push(row)
    bySourceKey.set(row.sourceKey, group)
  }

  const add = (row: NotionImportPreviewRow | undefined): boolean => {
    if (!row || selected.has(row.rowNumber) || selected.size >= limit) return false
    selected.set(row.rowNumber, row)
    return true
  }
  const addGroup = (rows: NotionImportPreviewRow[]): void => {
    const missing = rows.filter((row) => !selected.has(row.rowNumber))
    if (missing.length <= limit - selected.size) missing.forEach(add)
  }

  for (const row of preview.rows) {
    if (row.diagnostics.length === 0) continue
    addGroup(bySourceKey.get(row.sourceKey) ?? [row])
  }

  addFirstDistinct(preview.rows, selected, limit, (row) => `status:${String(row.values.status)}`, add)
  addFirstDistinct(preview.rows, selected, limit, (row) => `rating:${String(row.values.rating)}`, add)
  addFirstDistinct(preview.rows, selected, limit, (row) => `date:${dateShape(row)}`, add)

  for (const field of ['categories', 'tags', 'readDates', 'shortReview'] as const) {
    add(preview.rows.find((row) => hasValue(row.values[field])))
  }

  if (selected.size < limit) {
    const remaining = preview.rows.filter((row) => !selected.has(row.rowNumber))
    const needed = Math.min(limit - selected.size, remaining.length)
    for (let index = 0; index < needed; index += 1) {
      const position = Math.floor(((index + 0.5) * remaining.length) / needed)
      add(remaining[Math.min(position, remaining.length - 1)])
    }
  }

  return [...selected.values()].sort((left, right) => left.rowNumber - right.rowNumber)
}

function addFirstDistinct(
  rows: NotionImportPreviewRow[],
  selected: Map<number, NotionImportPreviewRow>,
  limit: number,
  keyFor: (row: NotionImportPreviewRow) => string,
  add: (row: NotionImportPreviewRow | undefined) => boolean
): void {
  const seen = new Set<string>()
  for (const row of rows) {
    if (selected.size >= limit) return
    const key = keyFor(row)
    if (seen.has(key)) continue
    seen.add(key)
    add(row)
  }
}

function dateShape(row: NotionImportPreviewRow): string {
  const value = String(row.values.readDates ?? '').trim()
  if (!value) return 'empty'
  if (value.includes('→')) return 'range'
  if (/\(GMT[+-]\d+\)/.test(value)) return 'timezone'
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(value)) return 'date'
  return 'other'
}

function hasValue(value: string | number | null): boolean {
  return value !== null && String(value).trim().length > 0
}
