import type { DictionaryEntry } from '../../domain'

interface Props { entries: readonly DictionaryEntry[]; value: string; onChange: (value: string) => void }
export function PublisherField({ entries, value, onChange }: Props) {
 const key = (name: string) => name.normalize('NFKC').trim().toLocaleLowerCase('zh-TW')
 const unique = new Map<string, DictionaryEntry>()
 for (const entry of entries) if (entry.kind === 'publisher' && !unique.has(key(entry.name))) unique.set(key(entry.name), entry)
 const matches = [...unique.values()].filter(entry => key(entry.name).includes(key(value))).sort((a,b) => a.name.localeCompare(b.name,'zh-Hant-TW'))
 return <div className="book-field publisher-field"><span className="field-requirement" aria-hidden="true">完整度必備</span>
  <label><span className="field-caption">出版社</span><input maxLength={200} value={value} placeholder="搜尋或輸入出版社" onChange={event => onChange(event.target.value)} /></label>
  <label><span className="sr-only">選擇既有出版社</span><select aria-label="選擇既有出版社" value="" onChange={event => { const entry = matches.find(item => item.id === event.target.value); if (entry) onChange(entry.name) }}>
   <option value="">{matches.length ? `選擇既有出版社（${matches.length}）` : '沒有符合的既有出版社'}</option>
   {matches.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
  </select></label>
  <p className="book-term-help">輸入文字可縮小選單；清空可看全部。沒有的出版社可直接輸入，儲存後加入選單。</p>
 </div>
}
