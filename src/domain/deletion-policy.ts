export type DeletableEntityType = 'book' | 'readingCycle' | 'readingRecord' | 'readingContent'
export type RelationAction = 'cascade' | 'detach' | 'none'

export interface DeletionRule {
  requiresConfirmation: boolean
  readingCycles: RelationAction
  readingRecords: RelationAction
  readingContents: RelationAction
  coverAsset: 'retainForCleanup' | 'notApplicable'
}

export const deletionPolicy: Readonly<Record<DeletableEntityType, DeletionRule>> = {
  book: {
    requiresConfirmation: true,
    readingCycles: 'cascade',
    readingRecords: 'cascade',
    readingContents: 'cascade',
    coverAsset: 'retainForCleanup'
  },
  readingCycle: {
    requiresConfirmation: true,
    readingCycles: 'none',
    readingRecords: 'cascade',
    readingContents: 'cascade',
    coverAsset: 'notApplicable'
  },
  readingRecord: {
    requiresConfirmation: true,
    readingCycles: 'none',
    readingRecords: 'none',
    readingContents: 'detach',
    coverAsset: 'notApplicable'
  },
  readingContent: {
    requiresConfirmation: false,
    readingCycles: 'none',
    readingRecords: 'none',
    readingContents: 'none',
    coverAsset: 'notApplicable'
  }
}
