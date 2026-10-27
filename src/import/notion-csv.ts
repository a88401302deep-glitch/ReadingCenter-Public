export type NotionImportField =
  | 'title'
  | 'externalId'
  | 'creator'
  | 'mediaType'
  | 'status'
  | 'rating'
  | 'categories'
  | 'tags'
  | 'readDates'
  | 'shortReview'
  | 'note'

export interface NotionFieldMapping extends Partial<Record<NotionImportField, string>> {
  title: string
}

export type NotionImportSeverity = 'error' | 'warning'

export interface NotionImportDiagnostic {
  severity: NotionImportSeverity
  code:
    | 'blank_header'
    | 'duplicate_header'
    | 'column_count_mismatch'
    | 'missing_title_mapping'
    | 'unknown_source_column'
    | 'empty_title'
    | 'invalid_rating'
    | 'duplicate_source_key'
  message: string
  rowNumber: number | null
  field: NotionImportField | null
}

export interface NotionCsvRow {
  rowNumber: number
  cells: string[]
  raw: Record<string, string>
}

export interface NotionCsvDocument {
  headers: string[]
  rows: NotionCsvRow[]
  diagnostics: NotionImportDiagnostic[]
}

export interface NotionImportPreviewRow {
  rowNumber: number
  sourceKey: string
  values: Record<NotionImportField, string | number | null>
  raw: Record<string, string>
  diagnostics: NotionImportDiagnostic[]
}

export interface NotionImportPreview {
  headers: string[]
  mapping: NotionFieldMapping
  rows: NotionImportPreviewRow[]
  diagnostics: NotionImportDiagnostic[]
  summary: {
    total: number
    valid: number
    withErrors: number
    withWarnings: number
  }
}

export class NotionImportConfigurationError extends Error {
  constructor(readonly diagnostics: NotionImportDiagnostic[]) {
    super('Notion import mapping is invalid')
    this.name = 'NotionImportConfigurationError'
  }
}

export function parseNotionCsv(input: string): NotionCsvDocument {
  const records = parseCsvRecords(input.replace(/^\uFEFF/, ''))
  if (records.length === 0) return { headers: [], rows: [], diagnostics: [] }

  const headers = records[0].map((header) => header.trim())
  const diagnostics: NotionImportDiagnostic[] = []
  const seenHeaders = new Set<string>()

  headers.forEach((header, index) => {
    if (!header) {
      diagnostics.push({
        severity: 'error',
        code: 'blank_header',
        message: `Column ${index + 1} has a blank header`,
        rowNumber: 1,
        field: null
      })
      return
    }
    if (seenHeaders.has(header)) {
      diagnostics.push({
        severity: 'error',
        code: 'duplicate_header',
        message: `Duplicate source column: ${header}`,
        rowNumber: 1,
        field: null
      })
    }
    seenHeaders.add(header)
  })

  const rows = records.slice(1).map((cells, index): NotionCsvRow => {
    const rowNumber = index + 2
    if (cells.length !== headers.length) {
      diagnostics.push({
        severity: 'warning',
        code: 'column_count_mismatch',
        message: `Row ${rowNumber} has ${cells.length} cells; expected ${headers.length}`,
        rowNumber,
        field: null
      })
    }
    const raw: Record<string, string> = {}
    headers.forEach((header, headerIndex) => {
      if (header && !(header in raw)) raw[header] = cells[headerIndex] ?? ''
    })
    return { rowNumber, cells, raw }
  })

  return { headers, rows, diagnostics }
}

export function createNotionImportPreview(
  document: NotionCsvDocument,
  mapping: NotionFieldMapping
): NotionImportPreview {
  const configurationDiagnostics = validateMapping(document, mapping)
  if (configurationDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    throw new NotionImportConfigurationError(configurationDiagnostics)
  }

  const duplicateKeys = new Map<string, number>()
  const rows = document.rows.map((row): NotionImportPreviewRow => {
    const diagnostics: NotionImportDiagnostic[] = []
    const text = (field: NotionImportField): string => {
      const column = mapping[field]
      return column ? (row.raw[column] ?? '').trim() : ''
    }
    const title = text('title')
    const creator = text('creator')
    const externalId = text('externalId')
    const ratingText = text('rating')
    let rating: number | null = null

    if (!title) {
      diagnostics.push({
        severity: 'error',
        code: 'empty_title',
        message: 'Title is required',
        rowNumber: row.rowNumber,
        field: 'title'
      })
    }

    if (ratingText) {
      const parsed = Number(ratingText)
      if (Number.isFinite(parsed)) rating = parsed
      else {
        diagnostics.push({
          severity: 'warning',
          code: 'invalid_rating',
          message: `Rating is not numeric: ${ratingText}`,
          rowNumber: row.rowNumber,
          field: 'rating'
        })
      }
    }

    const sourceKey = externalId
      ? `external:${externalId}`
      : `title:${normalizeKey(title)}|creator:${normalizeKey(creator)}`
    const firstRow = duplicateKeys.get(sourceKey)
    if (firstRow !== undefined) {
      diagnostics.push({
        severity: 'warning',
        code: 'duplicate_source_key',
        message: `Possible duplicate of row ${firstRow}`,
        rowNumber: row.rowNumber,
        field: externalId ? 'externalId' : 'title'
      })
    } else if (title || externalId) {
      duplicateKeys.set(sourceKey, row.rowNumber)
    }

    return {
      rowNumber: row.rowNumber,
      sourceKey,
      values: {
        title,
        externalId,
        creator,
        mediaType: text('mediaType'),
        status: text('status'),
        rating,
        categories: text('categories'),
        tags: text('tags'),
        readDates: text('readDates'),
        shortReview: text('shortReview'),
        note: text('note')
      },
      raw: row.raw,
      diagnostics
    }
  })

  const diagnostics = [
    ...document.diagnostics,
    ...configurationDiagnostics,
    ...rows.flatMap((row) => row.diagnostics)
  ]

  return {
    headers: document.headers,
    mapping: { ...mapping },
    rows,
    diagnostics,
    summary: {
      total: rows.length,
      valid: rows.filter((row) => row.diagnostics.length === 0).length,
      withErrors: rows.filter((row) =>
        row.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
      ).length,
      withWarnings: rows.filter((row) =>
        row.diagnostics.some((diagnostic) => diagnostic.severity === 'warning')
      ).length
    }
  }
}

function validateMapping(
  document: NotionCsvDocument,
  mapping: NotionFieldMapping
): NotionImportDiagnostic[] {
  const diagnostics = [...document.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')]
  if (!mapping.title?.trim()) {
    diagnostics.push({
      severity: 'error',
      code: 'missing_title_mapping',
      message: 'A source column must be selected for title',
      rowNumber: null,
      field: 'title'
    })
  }

  for (const [field, column] of Object.entries(mapping) as Array<[NotionImportField, string]>) {
    if (column?.trim() && !document.headers.includes(column)) {
      diagnostics.push({
        severity: 'error',
        code: 'unknown_source_column',
        message: `Mapped source column does not exist: ${column}`,
        rowNumber: null,
        field
      })
    }
  }
  return diagnostics
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function parseCsvRecords(input: string): string[][] {
  if (!input) return []

  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += character
      }
      continue
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      row.push(field)
      records.push(row)
      row = []
      field = ''
    } else {
      field += character
    }
  }

  if (inQuotes) throw new Error('Notion CSV contains an unclosed quoted field')
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    records.push(row)
  }
  return records
}
