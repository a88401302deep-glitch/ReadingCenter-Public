import type {
  ActivityLog,
  Book,
  BookCollection,
  DictionaryEntry,
  EntityId,
  EntityMetadata,
  ReadingContent,
  ReadingCycle,
  ReadingRecord,
  ReadingGoal,
  ReadingPreferences,
  SourceReadingDay,
  Work
} from '../domain'

export interface EntityRepository<T extends EntityMetadata> {
  getById(id: EntityId): Promise<T | undefined>
  getAll(): Promise<T[]>
  save(entity: T): Promise<void>
  delete(id: EntityId): Promise<void>
  clear(): Promise<void>
}

export interface ReadingCenterRepositories {
  sourceReadingDays: EntityRepository<SourceReadingDay>
  transaction?<T>(work: () => Promise<T>): Promise<T>
  works: EntityRepository<Work>
  activityLogs: EntityRepository<ActivityLog>
  books: EntityRepository<Book>
  readingCycles: EntityRepository<ReadingCycle>
  readingRecords: EntityRepository<ReadingRecord>
  readingContents: EntityRepository<ReadingContent>
  dictionaries: EntityRepository<DictionaryEntry>
  collections: EntityRepository<BookCollection>
  readingGoals: EntityRepository<ReadingGoal>
  readingPreferences: EntityRepository<ReadingPreferences>
}

