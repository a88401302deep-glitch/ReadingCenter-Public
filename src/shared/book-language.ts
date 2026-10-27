export const bookLanguageChoices = [
  { value: 'und', label: '未指定' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'zh-Hans', label: '簡體中文' },
  { value: 'ja', label: '日文' },
  { value: 'en', label: '英文' }
]

/** Canonicalization is for display only; never rewrite the stored source tag. */
export function getBookLanguageName(tag: string): string {
  try {
    const canonical = new Intl.Locale(tag).toString()
    const common = bookLanguageChoices.find(choice => choice.value === canonical)
    if (common) return common.label
    return new Intl.DisplayNames(['zh-Hant'], { type: 'language', fallback: 'none' }).of(canonical) ?? tag
  } catch { return tag }
}

export function getBookLanguageChoices(currentTag: string) {
  if (bookLanguageChoices.some(choice => choice.value === currentTag)) return bookLanguageChoices
  const name = getBookLanguageName(currentTag)
  return [...bookLanguageChoices, { value: currentTag, label: name === currentTag ? currentTag : `${name}（${currentTag}）` }]
}
