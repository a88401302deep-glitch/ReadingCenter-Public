import { describe, expect, it } from 'vitest'
import { createReadingCenterNotionPreview, normalizeReadingCenterNotionPreview } from '../../src/import'
import { buildNotionImportPlan } from '../../src/import/notion-import-plan'
import { stageNotionImport } from '../../src/import/notion-staging'
import { buildNotionCoverManifest } from '../../src/import/notion-cover-manifest'

const hash = 'a'.repeat(64)
const csv = ['書名,作者,閱讀,評分,主題,標籤,時間,一行心得,封面',
  '甲,作者,尚未開始,0,,,,,cover%201.jpg',
  '乙,作者,尚未開始,0,,,,,"cover.jpg, other.jpg"',
  '丙,作者,尚未開始,0,,,,,https://example.com/cover.jpg'].join('\n')

describe('Notion cover manifest preview', () => {
  it('decodes export filenames, keeps alternatives, and never treats external URLs as local files', () => {
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
    const staged = stageNotionImport(buildNotionImportPlan(hash, rows, {}))
    const manifest = buildNotionCoverManifest(staged, ['cover 1.jpg', 'cover.jpg', 'other.jpg'])
    expect(manifest.summary).toMatchObject({ referencedSourceRows: 3, localReferencesMatched: 3, externalReferences: 1, missingReferences: 0, workGroupsWithSuggestedLocalCover: 1, workGroupsNeedingSelection: 1, workGroupsNeedingExternalDownload: 1, workGroupsNeedingMissingCoverRecovery: 0 })
    expect(manifest.workGroups[0].suggestedArchiveFile).toBe('cover 1.jpg')
    expect(manifest.workGroups[1]).toMatchObject({ suggestedArchiveFile: null, needsCoverSelection: true })
    expect(manifest.workGroups[2]).toMatchObject({ needsCoverSelection: false, needsExternalCoverDownload: true, references: [{ archiveFile: null, availability: 'external-url' }] })
    expect(manifest.formalWriteReady).toBe(false)
  })
  it('accepts byte-identical files as one image without discarding either source reference', () => {
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
    const staged = stageNotionImport(buildNotionImportPlan(hash, rows, {}))
    const digest = 'c'.repeat(64)
    const manifest = buildNotionCoverManifest(staged, ['cover 1.jpg', 'cover.jpg', 'other.jpg'], { 'cover.jpg': digest, 'other.jpg': digest })
    expect(manifest.workGroups[1]).toMatchObject({ suggestedArchiveFile: 'cover.jpg', identicalImageFiles: true, needsCoverSelection: false })
    expect(manifest.workGroups[1].references).toHaveLength(2)
    expect(manifest.summary.workGroupsWithIdenticalImageFiles).toBe(1)
  })
  it('accepts a reviewed cover only for the same rows and exact archive bytes', () => {
    const rows = normalizeReadingCenterNotionPreview(createReadingCenterNotionPreview(csv))
    const staged = stageNotionImport(buildNotionImportPlan(hash, rows, {}))
    const review = { sourceRowNumbers: [3], archiveFile: 'other.jpg', expectedSha256: 'd'.repeat(64), evidenceUrl: 'https://example.com/book/3', reason: 'The other image belongs to a different title' }
    const files = ['cover 1.jpg', 'cover.jpg', 'other.jpg']
    const manifest = buildNotionCoverManifest(staged, files, { 'other.jpg': 'd'.repeat(64) }, [review])
    expect(manifest.summary).toMatchObject({ workGroupsWithReviewedSelection: 1, workGroupsNeedingSelection: 0, workGroupsNeedingExternalDownload: 1 })
    expect(manifest.workGroups[1]).toMatchObject({ suggestedArchiveFile: 'other.jpg', reviewedSelection: review, needsCoverSelection: false })
    expect(manifest.workGroups[1].references).toHaveLength(2)
    expect(() => buildNotionCoverManifest(staged, files, { 'other.jpg': 'e'.repeat(64) }, [review])).toThrow('Invalid cover review')
    expect(() => buildNotionCoverManifest(staged, files, { 'other.jpg': 'd'.repeat(64) }, [{ ...review, sourceRowNumbers: [99] }])).toThrow('do not match')
  })
})
