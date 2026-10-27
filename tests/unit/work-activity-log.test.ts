import { describe, expect, it } from 'vitest'
import {
  assertValidActivityLog,
  assertValidWork,
  createMetadata,
  migrateBookToWork,
  migrateReadingRecordToActivityLog,
  type ActivityLog,
  type Book,
  type ReadingRecord,
  type Work
} from '../../src/domain'

const now = '2026-09-20T12:00:00.000Z'

const baseWork = (): Work => ({
  ...createMetadata({ id: 'work-1', now }),
  title: '唐草人偶',
  preferredTitle: null,
  subtitle: null,
  originalTitle: null,
  languageTag: 'zh-Hant',
  titleAliases: [],
  externalReferences: [],
  mediaType: 'book',
  creatorIds: [],
  categoryIds: [],
  tagIds: [],
  sourceIds: [],
  cover: null,
  note: '',
  typeMetadata: {
    kind: 'publication',
    publicationKind: 'published',
    collectionId: null,
    sequence: null,
    serialization: null,
    isbn: null,
    publishedOn: null,
    publisherId: null
  }
})

describe('Work contract', () => {
  it('accepts core and future media types without separate entity models', () => {
    expect(() => assertValidWork(baseWork())).not.toThrow()
    expect(() => assertValidWork({ ...baseWork(), mediaType: 'audioDrama' })).not.toThrow()
  })

  it('validates episodic metadata without requiring an audiovisual UI', () => {
    expect(() =>
      assertValidWork({
        ...baseWork(),
        mediaType: 'anime',
        typeMetadata: {
          kind: 'episodic',
          season: 1,
          episode: 3,
          totalEpisodes: 12,
          airingStatus: 'airing'
        }
      })
    ).not.toThrow()
  })
})

describe('ActivityLog contract', () => {
  it('supports multiple read or watch activities for one Work', () => {
    const activities: ActivityLog[] = [
      {
        ...createMetadata({ id: 'activity-1', now }),
        workId: 'work-1',
        cycleId: 'cycle-1',
        activityType: 'read',
        startedAt: '2026-09-20T12:00:00.000Z',
        endedAt: '2026-09-20T13:00:00.000Z',
        durationMinutes: 60,
        progressBefore: { unit: 'percent', value: 10 },
        progressAfter: { unit: 'percent', value: 30 },
        deviceId: null,
        sourceId: null,
        note: ''
      },
      {
        ...createMetadata({ id: 'activity-2', now }),
        workId: 'work-1',
        cycleId: null,
        activityType: 'watch',
        startedAt: '2026-09-21T12:00:00.000Z',
        endedAt: '2026-09-21T12:58:00.000Z',
        durationMinutes: 58,
        progressBefore: { unit: 'episode', value: 0, total: 12, season: 1, label: null },
        progressAfter: { unit: 'episode', value: 1, total: 12, season: 1, label: 'S01E01' },
        deviceId: null,
        sourceId: null,
        note: ''
      }
    ]

    activities.forEach(assertValidActivityLog)
    expect(new Set(activities.map((activity) => activity.workId))).toEqual(new Set(['work-1']))
  })

  it('allows a valid activity to cross midnight', () => {
    expect(() =>
      assertValidActivityLog({
        ...createMetadata({ id: 'activity-cross-day', now }),
        workId: 'work-1',
        cycleId: null,
        activityType: 'read',
        startedAt: '2026-09-20T23:40:00.000Z',
        endedAt: '2026-09-21T00:20:00.000Z',
        durationMinutes: 40,
        progressBefore: null,
        progressAfter: null,
        deviceId: null,
        sourceId: null,
        note: ''
      })
    ).not.toThrow()
  })
})

describe('legacy migration mappings', () => {
  it('preserves Book identity and metadata when mapping to Work', () => {
    const book: Book = {
      ...createMetadata({ id: 'book-1', now }),
      title: '唐草人偶',
      preferredTitle: null,
      subtitle: null,
      originalTitle: null,
      languageTag: 'ja',
      titleAliases: [],
      externalReferences: [],
      publicationKind: 'published',
      collectionId: null,
      sequence: null,
      serialization: null,
      isbn: '9780000000000',
      publishedOn: null,
      authorIds: ['author-1'],
      publisherId: 'publisher-1',
      mediaTypeId: 'ebook',
      categoryIds: ['category-1'],
      tagIds: ['tag-1'],
      sourceIds: ['source-1'],
      cover: null,
      bookNote: '人工備註'
    }

    const work = migrateBookToWork(book)

    expect(work.id).toBe(book.id)
    expect(work.revision).toBe(book.revision)
    expect(work.provenance).toEqual(book.provenance)
    expect(work.mediaType).toBe('book')
    expect(work.creatorIds).toEqual(['author-1'])
    expect(work.note).toBe('人工備註')
    expect(work.typeMetadata).toMatchObject({ kind: 'publication', isbn: '9780000000000' })
  })

  it('maps a ReadingRecord to a read ActivityLog without inventing previous progress', () => {
    const record: ReadingRecord = {
      ...createMetadata({ id: 'record-1', now }),
      bookId: 'book-1',
      cycleId: 'cycle-1',
      startedAt: now,
      endedAt: '2026-09-20T12:42:00.000Z',
      durationMinutes: 42,
      progress: { unit: 'percent', value: 35 },
      deviceId: 'device-1',
      sourceId: 'source-1'
    }

    const activity = migrateReadingRecordToActivityLog(record)

    expect(activity.id).toBe(record.id)
    expect(activity.workId).toBe(record.bookId)
    expect(activity.activityType).toBe('read')
    expect(activity.progressBefore).toBeNull()
    expect(activity.progressAfter).toEqual(record.progress)
    expect(() => assertValidActivityLog(activity)).not.toThrow()
  })
})
