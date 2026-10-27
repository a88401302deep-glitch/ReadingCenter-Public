import type { EntityId, EntityMetadata } from '../domain'
import type { EntityRepository, ReadingCenterRepositories } from './repository'

export class InMemoryRepository<T extends EntityMetadata> implements EntityRepository<T> {
  private readonly entities = new Map<EntityId, T>()

  async getById(id: EntityId): Promise<T | undefined> {
    return this.entities.get(id)
  }

  async getAll(): Promise<T[]> {
    return [...this.entities.values()]
  }

  async save(entity: T): Promise<void> {
    this.entities.set(entity.id, entity)
  }

  async delete(id: EntityId): Promise<void> {
    this.entities.delete(id)
  }

  async clear(): Promise<void> {
    this.entities.clear()
  }
}

export function createInMemoryRepositories(): ReadingCenterRepositories {
  return {
    sourceReadingDays: new InMemoryRepository(),
    works: new InMemoryRepository(),
    activityLogs: new InMemoryRepository(),
    books: new InMemoryRepository(),
    readingCycles: new InMemoryRepository(),
    readingRecords: new InMemoryRepository(),
    readingContents: new InMemoryRepository(),
    dictionaries: new InMemoryRepository(),
    collections: new InMemoryRepository(),
    readingGoals: new InMemoryRepository(),
    readingPreferences: new InMemoryRepository()
  }
}

