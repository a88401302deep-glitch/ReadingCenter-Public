import { createMetadata, type BookCover, type ReadingCycleStatus } from '../domain'
import { buildNotionEntityPrototype } from './notion-entity-prototype'
import type { buildNotionImportPlan } from './notion-import-plan'
import { stageNotionImport } from './notion-staging'
import type { NotionBatchItem } from './notion-pilot-batch'

type Plan = ReturnType<typeof buildNotionImportPlan>

/** One-time migration: only explicit same-reading decisions combine source rows. */
export function stageNotionBulkImport(plan: Plan) {
  const sourceStatuses: Record<string, ReadingCycleStatus> = { '尚未開始': 'planned', '閱讀中': 'reading', '已讀完': 'completed', '暫停': 'paused', '棄坑': 'abandoned', '閱讀(連載)': 'reading' }
  const items = plan.items.map((item) => item.pendingReviewCodes.includes('completion_date_status_conflict')
    ? { ...item, suggested: { ...item.suggested, status: sourceStatuses[item.source['閱讀']?.trim()] ?? null, completionDate: null } }
    : item)
  return stageNotionImport({ ...plan, items, workGroupingProposals: [] })
}

export function buildNotionBulkBatch(plan: Plan, rows: readonly number[], now: string, cover?: BookCover, staging = stageNotionBulkImport(plan)): NotionBatchItem[] {
  if (staging.csvSha256 !== plan.csvSha256) throw new Error('Migration staging belongs to another snapshot')
  const group = staging.workGroups.find((item) => item.sourceRowNumbers.length === rows.length && item.sourceRowNumbers.every((row) => rows.includes(row)))
  if (!group) throw new Error('Migration selection does not match source rows')
  // A missing title remains an identifiable source record, never a guessed title.
  const preservedTitle = group.title || `未命名（Notion 來源第 ${rows.join('、')} 列）`
  const migrationStaging = { ...staging, workGroups: staging.workGroups.map((item) => item === group ? { ...item, title: preservedTitle, blockedByMissingTitle: false, conflictingRatings: false } : item) }
  const prototype = buildNotionEntityPrototype(plan, migrationStaging, rows, now)
  const bookId = `notion:book:${group.stagingKey}`
  if (prototype.books.length !== 1) throw new Error('Migration requires one source work')
  if (cover && !cover.path.startsWith(`/api/v1/covers/covers/${encodeURIComponent(bookId)}/`)) throw new Error('Migration cover belongs to another book')
  const dictionaryIds = new Map(prototype.dictionaryEntries.map((entry) => [entry.id, `notion:dictionary:${plan.csvSha256}:${entry.kind}:${encodeURIComponent(entry.name)}`]))
  const sourceItems = plan.items.filter((item) => rows.includes(item.rowNumber))
  const notes = [
    'Notion 歷史搬遷｜原始資料保留',
    ...sourceItems.flatMap((item) => [
      `【來源第 ${item.rowNumber} 列】`,
      ...Object.entries(item.source).map(([field, value]) => `${field}：${value}`),
      ...(item.pendingReviewCodes.length ? ['此列有未確定欄位；依原始資料保留，不阻擋使用。'] : [])
    ]),
    ...(prototype.blocked.length ? ['閱讀狀態或天數未能確定；原始值已保留，未補造閱讀週期。'] : []),
    ...(staging.longReviewFlags.some((flag) => rows.includes(flag.sourceRowNumber)) ? ['來源標示有長篇心得；CSV 沒有正文，正文尚未搬入。'] : []),
    ...(sourceItems.some((item) => item.suggested.duplicate === 'same-work') ? ['同名／同作品候選分開保留，尚未合併。'] : [])
  ].join('\n')
  const mediaTypeId = `notion:dictionary:${plan.csvSha256}:mediaType:unmapped`
  return [
    { kind: 'dictionary', entity: { ...createMetadata({ id: mediaTypeId, now, provenance: { kind: 'import', sourceId: 'notion-csv-snapshot', externalId: `${plan.csvSha256}:mediaType:unmapped`, importedAt: now } }), kind: 'mediaType', name: '未分類', color: null } },
    ...prototype.dictionaryEntries.map((entry): NotionBatchItem => ({ kind: 'dictionary', entity: { ...entry, id: dictionaryIds.get(entry.id)! } })),
    { kind: 'book', entity: {
      ...prototype.books[0], id: bookId, mediaTypeId, cover: cover ?? null,
      authorIds: prototype.books[0].authorIds.map((id) => dictionaryIds.get(id)!),
      publisherId: prototype.books[0].publisherId ? dictionaryIds.get(prototype.books[0].publisherId)! : null,
      categoryIds: prototype.books[0].categoryIds.map((id) => dictionaryIds.get(id)!),
      tagIds: prototype.books[0].tagIds.map((id) => dictionaryIds.get(id)!),
      sourceIds: prototype.books[0].sourceIds.map((id) => dictionaryIds.get(id)!),
      bookNote: '', importSourceNotes: notes
    } },
    ...prototype.readingCycles.map((cycle): NotionBatchItem => ({ kind: 'readingCycle', entity: { ...cycle, id: `notion:cycle:${cycle.provenance.kind === 'import' ? cycle.provenance.externalId : cycle.id}`, bookId } })),
    ...prototype.readingContents.map((content): NotionBatchItem => ({ kind: 'readingContent', entity: { ...content, id: `notion:short-review:${content.provenance.kind === 'import' ? content.provenance.externalId.replace(/:short-review$/, '') : content.id}`, bookId } }))
  ]
}
