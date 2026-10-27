import type { EntityId } from './common'

export const CREATOR_ROLES = ['author', 'translator', 'original', 'manga', 'illustration', 'supervision', 'oral', 'interviewWriting'] as const
export type CreatorRole = (typeof CREATOR_ROLES)[number]
export interface CreatorCredit { creatorId: EntityId; role: CreatorRole }
export const CREATOR_ROLE_LABELS: Readonly<Record<CreatorRole, string>> = {
  author: '作者', translator: '譯者', original: '原作', manga: '漫畫', illustration: '繪圖', supervision: '監修', oral: '口述', interviewWriting: '採訪撰文'
}

export function assertValidCreatorCredits(credits: CreatorCredit[] | undefined): void {
  if (credits === undefined) return
  if (!Array.isArray(credits)) throw new Error('創作者角色必須是清單')
  const seen = new Set<string>()
  for (const credit of credits) {
    if (!credit || typeof credit.creatorId !== 'string' || !credit.creatorId.trim() || !CREATOR_ROLES.includes(credit.role)) throw new Error('創作者角色格式不符')
    const key = JSON.stringify([credit.creatorId, credit.role])
    if (seen.has(key)) throw new Error('創作者角色不得重複')
    seen.add(key)
  }
}
