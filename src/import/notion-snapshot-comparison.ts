import type { buildNotionImportPlan } from './notion-import-plan'

type Plan = ReturnType<typeof buildNotionImportPlan>
type Item = Plan['items'][number]

/** A cover filename can change between exports while the record stays the same. */
function comparableSource(item: Item): string {
  return JSON.stringify(Object.keys(item.source).filter((key) => key !== '封面').sort().map((key) => [key, item.source[key]]))
}

/** Suggestions only: even a unique content match is not a permanent Notion page identity. */
export function compareNotionSnapshots(previous: Plan, next: Plan) {
  if (previous.kind !== 'notion-import-plan-preview' || next.kind !== 'notion-import-plan-preview') throw new Error('Expected two Notion import plans')
  const oldGroups = new Map<string, Item[]>()
  const newGroups = new Map<string, Item[]>()
  for (const item of previous.items) oldGroups.set(comparableSource(item), [...(oldGroups.get(comparableSource(item)) ?? []), item])
  for (const item of next.items) newGroups.set(comparableSource(item), [...(newGroups.get(comparableSource(item)) ?? []), item])
  const matches = next.items.map((item) => {
    const signature = comparableSource(item)
    const old = oldGroups.get(signature) ?? []
    const current = newGroups.get(signature) ?? []
    if (old.length === 1 && current.length === 1) {
      return { rowNumber: item.rowNumber, kind: 'unique-content-candidate' as const, previousRowNumbers: [old[0].rowNumber] }
    }
    if (old.length || current.length > 1) {
      return { rowNumber: item.rowNumber, kind: 'ambiguous' as const, previousRowNumbers: old.map((row) => row.rowNumber) }
    }
    return { rowNumber: item.rowNumber, kind: 'unmatched' as const, previousRowNumbers: [] }
  })
  return {
    previousCsvSha256: previous.csvSha256,
    nextCsvSha256: next.csvSha256,
    formalWriteReady: false as const,
    summary: {
      uniqueContentCandidates: matches.filter((match) => match.kind === 'unique-content-candidate').length,
      ambiguousRows: matches.filter((match) => match.kind === 'ambiguous').length,
      unmatchedRows: matches.filter((match) => match.kind === 'unmatched').length
    },
    matches
  }
}
