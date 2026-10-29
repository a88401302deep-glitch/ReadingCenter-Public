import type { DictionaryEntry } from '../../domain'
import type { MultiSelectOption } from '../../shared/ui/MultiSelect'

// Curated starter vocabulary, not a live mirror or automatic book classification.
// Research and Readmoo references: docs/READMOO_TERM_CHOICES.md.
const vocabulary = {
 category: ['商業理財', '文學小說', '社會科學', '生活風格', '藝術設計', '自然科普', '勵志成長', '醫療保健', '旅遊觀光', '教育', '青少年與兒童', '宗教', '羅曼史／言情小說'],
 tag: ['推理', '懸疑', '驚悚', '犯罪', '本格推理', '社會派推理', '密室推理', '都市傳說', '奇幻', '科幻', '異世界', '冒險', '魔法', '愛情', 'BL', 'GL', '歷史', '神話', '成長', '家庭', '心理', '哲學', '投資', '理財', '人工智慧'],
} as const
export type BookTermKind = keyof typeof vocabulary
export const termKey = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('zh-TW')
export const bookTermPresets = (kind: BookTermKind): MultiSelectOption[] => vocabulary[kind].map(label => ({ id: `book-term:${kind}:${label}`, label }))

/** Reuse exact normalized names without merging or renaming existing entries. */
export function bookTermOptions(kind: BookTermKind, entries: readonly DictionaryEntry[]): MultiSelectOption[] {
 const existing = entries.filter(entry => entry.kind === kind).map(entry => ({ id: entry.id, label: entry.name }))
 return [...existing, ...bookTermPresets(kind).filter(preset => !existing.some(entry => termKey(entry.label) === termKey(preset.label)))]
}
