import type { ReadingCompletionDate, ReadingCycleStatus } from '../domain/reading-cycle'
import type { NotionImportPreview, NotionImportPreviewRow } from './notion-csv'

export type NotionCompletionDate = ReadingCompletionDate

/** Reading statuses map to the shared ReadingCycle status vocabulary. */
export type NotionSuggestedStatus = ReadingCycleStatus

export type NotionReviewCode =
  | 'missing_title'
  | 'duplicate_candidate'
  | 'author_url'
  | 'unknown_status'
  | 'missing_status'
  | 'serial_status'
  | 'zero_rating_conflict'
  | 'invalid_rating'
  | 'invalid_date'
  | 'completed_without_date'
  | 'completion_date_status_conflict'
  | 'category_delimiter'

export interface NotionNormalizationRow {
  rowNumber: number
  sourceKey: string
  /** Page creation and rollup duration are never reading evidence. */
  readingEvidence: { hasRead: boolean; fromTime: boolean; fromDailyRelation: boolean }
  proposed: {
    title: string
    creator: string | null
    status: NotionSuggestedStatus | null
    rating: number | null
    completionDate: NotionCompletionDate | null
  }
  reviewCodes: NotionReviewCode[]
  /** The original source row remains available for an explicit field-by-field decision. */
  source: NotionImportPreviewRow
}

/** Read-only suggestions. No Work, cycle, or ActivityLog is created. */
export function normalizeReadingCenterNotionPreview(preview: NotionImportPreview): NotionNormalizationRow[] {
  const keyCounts = new Map<string, number>()
  for (const row of preview.rows) keyCounts.set(row.sourceKey, (keyCounts.get(row.sourceKey) ?? 0) + 1)
  return preview.rows.map((source) => {
    const codes = new Set<NotionReviewCode>()
    const title = String(source.values.title ?? '').trim()
    const rawCreator = String(source.values.creator ?? '').trim()
    const rawStatus = String(source.values.status ?? '').trim()
    const rawDate = String(source.values.readDates ?? '').trim()
    const fromDailyRelation = Boolean(String(source.raw['關聯生活點滴'] ?? '').trim())
    const rawRating = source.values.rating
    const stars = (source.raw['喜好'] ?? '').trim()

    if (!title) codes.add('missing_title')
    if ((keyCounts.get(source.sourceKey) ?? 0) > 1 && title) codes.add('duplicate_candidate')
    const creator = /https?:\/\//i.test(rawCreator) ? null : rawCreator || null
    if (rawCreator && creator === null) codes.add('author_url')

    const sourceStatus = normalizeStatus(rawStatus, codes)
    let rating: number | null = null
    if (rawRating === 0) {
      // The verified export pairs every zero with an empty star field.
      // A new export that contradicts this pattern must be reviewed.
      if (stars) codes.add('zero_rating_conflict')
    } else if (typeof rawRating === 'number' && Number.isInteger(rawRating) && rawRating >= 1 && rawRating <= 5) {
      rating = rawRating
    } else if (rawRating !== null) {
      codes.add('invalid_rating')
    } else if (source.diagnostics.some((item) => item.code === 'invalid_rating')) {
      codes.add('invalid_rating')
    }

    const completionDate = rawDate ? parseCompletionDate(rawDate, codes) : null
    if (sourceStatus === 'completed' && !completionDate) codes.add('completed_without_date')
    // The user confirmed that a completion date indicates completion. Retain the
    // contradictory source status and require review before any formal import.
    if (sourceStatus !== 'completed' && completionDate) codes.add('completion_date_status_conflict')
    const status = completionDate && sourceStatus !== 'completed' ? 'completed' : sourceStatus
    if (/[\\,]/.test(String(source.values.categories ?? ''))) codes.add('category_delimiter')

    return {
      rowNumber: source.rowNumber,
      sourceKey: source.sourceKey,
      readingEvidence: { hasRead: Boolean(rawDate) || fromDailyRelation, fromTime: Boolean(rawDate), fromDailyRelation },
      proposed: { title, creator, status, rating, completionDate },
      reviewCodes: [...codes],
      source
    }
  })
}

function normalizeStatus(value: string, codes: Set<NotionReviewCode>): NotionSuggestedStatus | null {
  if (!value) { codes.add('missing_status'); return null }
  switch (value) {
    case '尚未開始': return 'planned'
    case '閱讀中': return 'reading'
    case '暫停': return 'paused'
    case '已讀完': return 'completed'
    case '棄坑': return 'abandoned'
    case '閱讀(連載)': codes.add('serial_status'); return 'reading'
    default: if (value) codes.add('unknown_status'); return null
  }
}

function parseCompletionDate(value: string, codes: Set<NotionReviewCode>): NotionCompletionDate | null {
  const range = /^(\d{4}\/\d{2}\/\d{2})\s*→\s*(\d{4}\/\d{2}\/\d{2})$/.exec(value)
  if (range) {
    const startedOn = isoDate(range[1])
    const completedOn = isoDate(range[2])
    if (!startedOn || !completedOn || completedOn < startedOn) { codes.add('invalid_date'); return null }
    return { precision: 'range', startedOn, completedOn }
  }

  const timestamp = /^(\d{4}\/\d{2}\/\d{2})\s*(上午|下午)(\d{1,2}):(\d{2})\s*\(GMT\+8\)$/.exec(value)
  if (timestamp) {
    const date = isoDate(timestamp[1])
    const hour = Number(timestamp[3])
    const minute = Number(timestamp[4])
    if (!date || hour < 1 || hour > 12 || minute > 59) { codes.add('invalid_date'); return null }
    const hour24 = (hour % 12) + (timestamp[2] === '下午' ? 12 : 0)
    return { precision: 'minute', completedOn: date, localTime: `${String(hour24).padStart(2, '0')}:${timestamp[4]}`, offsetMinutes: 480 }
  }

  const date = isoDate(value)
  if (date) return { precision: 'date', completedOn: date }
  codes.add('invalid_date')
  return null
}

function isoDate(value: string): string | null {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(value)
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${match[1]}-${match[2]}-${match[3]}`
}
