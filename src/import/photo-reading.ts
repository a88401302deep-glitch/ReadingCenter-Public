import { assertValidReadingCycle, createMetadata, type ReadingCycle } from '../domain'
import type { ReadingCenterRepositories } from '../data'

export interface PhotoReadingDraft { completedOn: string; totalMinutes: string; allowReread: boolean; progressPercent?: string; startedOn?: string; lastReadOn?: string; status?: 'reading' | 'completed' }
export const emptyPhotoReading: PhotoReadingDraft = { completedOn: '', totalMinutes: '', allowReread: false }

/** Explicit confirmation only. Cumulative duration is not a dated reading session. */
export async function confirmPhotoReading(repositories: ReadingCenterRepositories, bookId: string, hash: string, draft: PhotoReadingDraft): Promise<ReadingCycle> {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('圖片識別無效')
  const completedOn = draft.completedOn.trim()
  const startedOn = draft.startedOn?.trim() || null, lastReadOn = draft.lastReadOn?.trim() || null
  const rawProgress = draft.progressPercent?.trim() ?? ''
  const progressPercent = rawProgress === '' ? null : Number(rawProgress)
  if (progressPercent !== null && (!/^\d+(?:\.\d+)?$/.test(rawProgress) || !Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100)) throw new Error('閱讀進度應為 0 至 100 的百分比；不確定請清空')
  const status = draft.status ?? 'completed'
  if (!['reading', 'completed'].includes(status)) throw new Error('請核對閱讀狀態')
  if (status === 'reading' && completedOn) throw new Error('閱讀中不能填寫完讀日期')
  if (status === 'reading' && !startedOn && !lastReadOn && progressPercent === null) throw new Error('請填寫截圖中可確認的閱讀日期或進度')
  const totalMinutes = draft.totalMinutes.trim() === '' ? null : Number(draft.totalMinutes)
  if (totalMinutes !== null && (!/^\d+$/.test(draft.totalMinutes.trim()) || !Number.isSafeInteger(totalMinutes))) throw new Error('累計閱讀分鐘應為非負整數；不確定請清空')
  const persist = async () => {
    if (!await repositories.books.getById(bookId)) throw new Error('找不到所屬書籍，請先確認書籍配對')
    const cycles = (await repositories.readingCycles.getAll()).filter(cycle => cycle.bookId === bookId)
    const now = new Date().toISOString(), externalId = `${hash}:${bookId}`
    const cycle: ReadingCycle = {
      ...createMetadata({ id: `photo-cycle:${externalId}`, now, provenance: { kind: 'import', sourceId: 'photo-import', externalId, importedAt: now } }),
      bookId, sequence: Math.max(0, ...cycles.map(value => value.sequence)) + 1, status,
      startedAt: null, finishedAt: null,
      ...(startedOn ? { startedOn } : {}), ...(lastReadOn ? { lastReadOn } : {}),
      completionDate: status === 'completed' ? { precision: 'date', completedOn } : null,
      ...(progressPercent !== null ? { reportedProgressPercent: progressPercent } : {}),
      reportedDurationMinutes: totalMinutes, abandonedReason: null
    }
    assertValidReadingCycle(cycle)
    const repeated = cycles.find(value => value.id === cycle.id)
    if (repeated) {
      if ((repeated.reportedProgressPercent ?? null) !== progressPercent || repeated.status !== status || (repeated.startedOn ?? null) !== startedOn || (repeated.lastReadOn ?? null) !== lastReadOn || (repeated.completionDate?.completedOn ?? '') !== completedOn || (repeated.reportedDurationMinutes ?? null) !== totalMinutes) throw new Error('此圖片已補登閱讀紀錄，內容不同；請到閱讀紀錄核對，未新增或覆寫')
      return repeated
    }
    const completed = cycles.filter(value => value.status === 'completed')
    // Cross-image and cross-source checks use date-only evidence, never import timestamps.
    if (status === 'reading' && cycles.some(value => value.status === 'reading' || value.status === 'paused')) throw new Error('已有閱讀中的紀錄，請到閱讀紀錄核對；未重複新增')
    if (status === 'completed' && completed.some(value => value.completionDate?.completedOn === completedOn || value.finishedAt && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value.finishedAt)) === completedOn)) throw new Error('這本書同一天已有完讀紀錄，未重複新增；請先核對既有紀錄')
    if (completed.length && !draft.allowReread) throw new Error('這本書已有完讀紀錄；若本次是重讀，請勾選確認')
    await repositories.readingCycles.save(cycle)
    return cycle
  }
  return repositories.transaction ? repositories.transaction(persist) : persist()
}
