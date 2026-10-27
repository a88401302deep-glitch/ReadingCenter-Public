import type { EntityMetadata } from './common'

export const readingPreferencesId = 'reading-preferences:display'
export const defaultMonthColors = ['#a98c80', '#b68d98', '#a88fa8', '#8f9aae', '#849fa0', '#819b88', '#9ca27d', '#b1a16f', '#b49268', '#aa806a', '#927b72', '#7f858f'] as const
export interface ReadingPreferences extends EntityMetadata { monthColors: string[] }
export function assertValidReadingPreferences(value: ReadingPreferences): void {
  if (value.id !== readingPreferencesId || value.provenance.kind !== 'manual') throw new Error('配色設定識別碼或來源無效')
  if (!Array.isArray(value.monthColors) || value.monthColors.length !== 12 || Array.from(value.monthColors).some(color => typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color))) throw new Error('需要 12 個有效月份顏色')
}
export function readingMonthColors(value?: ReadingPreferences | null): readonly string[] { return value?.monthColors ?? defaultMonthColors }
