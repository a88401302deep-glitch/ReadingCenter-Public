import { assertValidReadingCycle, createMetadata, type ReadingCycle } from '../domain'
import type { ReadingCenterRepositories } from '../data'

export interface PhotoReadingDraft { completedOn: string; totalMinutes: string; allowReread: boolean }
export const emptyPhotoReading: PhotoReadingDraft = { completedOn: '', totalMinutes: '', allowReread: false }

/** Explicit confirmation only. Cumulative duration is not a dated reading session. */
export async function confirmPhotoReading(repositories: ReadingCenterRepositories, bookId: string, hash: string, draft: PhotoReadingDraft): Promise<ReadingCycle> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('圖片識別無效')
  const completedOn = draft.completedOn.trim()
  const totalMinutes = draft.totalMinutes.trim() === '' ? null : Number(draft.totalMinutes)
  if (totalMinutes !== null && (!/^\d+$/.test(draft.totalMinutes.trim()) || !Number.isSafeInteger(totalMinutes))) throw new Error('累計閱讀分鐘應為非負整數；不確定請清空')
  const persist = async () => {
    if (!await repositories.books.getById(bookId)) throw new Error('找不到所屬書籍，請先確認書籍配對')
    const cycles = (await repositories.readingCycles.getAll()).filter(cycle => cycle.bookId === bookId)
    const now = new Date().toISOString(), externalId = `${hash}:${bookId}`
    const cycle: ReadingCycle = {
      ...createMetadata({ id: `photo-cycle:${externalId}`, now, provenance: { kind: 'import', sourceId: 'photo-import', externalId, importedAt: now } }),
      bookId, sequence: Math.max(0, ...cycles.map(value => value.sequence)) + 1, status: 'completed',
      startedAt: null, finishedAt: null, completionDate: { precision: 'date', completedOn },
      reportedDurationMinutes: totalMinutes, abandonedReason: null
    }
    assertValidReadingCycle(cycle)
    const repeated = cycles.find(value => value.id === cycle.id)
    if (repeated) {
      if (repeated.completionDate?.completedOn !== completedOn || (repeated.reportedDurationMinutes ?? null) !== totalMinutes) throw new Error('此圖片已補登閱讀紀錄，內容不同；請到閱讀紀錄核對，未新增或覆寫')
      return repeated
    }
    const completed = cycles.filter(value => value.status === 'completed')
    // Cross-image and cross-source checks use date-only evidence, never import timestamps.
    if (completed.some(value => value.completionDate?.completedOn === completedOn || value.finishedAt && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value.finishedAt)) === completedOn)) throw new Error('這本書同一天已有完讀紀錄，未重複新增；請先核對既有紀錄')
    if (completed.length && !draft.allowReread) throw new Error('這本書已有完讀紀錄；若本次是重讀，請勾選確認')
    await repositories.readingCycles.save(cycle)
    return cycle
  }
  return repositories.transaction ? repositories.transaction(persist) : persist()
}
