export type ReadingProgress =
  | { unit: 'percent'; value: number }
  | { unit: 'page'; value: number; total: number | null }
  | { unit: 'chapter'; value: number; total: number | null; label: string | null }
  | { unit: 'position'; value: number; total: number | null; label: string | null }

export function assertValidProgress(progress: ReadingProgress | null): void {
  if (progress === null) return
  if (!Number.isFinite(progress.value) || progress.value < 0) {
    throw new Error('Progress value must be a non-negative finite number')
  }

  if (progress.unit === 'percent' && progress.value > 100) {
    throw new Error('Percent progress must be between 0 and 100')
  }

  if (progress.unit !== 'percent' && progress.total !== null) {
    if (!Number.isFinite(progress.total) || progress.total <= 0) {
      throw new Error('Progress total must be a positive finite number')
    }
    if (progress.value > progress.total) {
      throw new Error('Progress value must not exceed total')
    }
  }
}
