import { useId, useMemo, useState } from 'react'
import { Button } from './Button'
import { Tag } from './Tag'

export interface MultiSelectOption { id: string; label: string }
interface MultiSelectProps {
  kind: 'category' | 'tag' | 'source'
  label: string
  options: MultiSelectOption[]
  recommendations?: MultiSelectOption[]
  chooseFromList?: boolean
  value: string[]
  onChange: (value: string[]) => void
}

export function MultiSelect({ kind, label, onChange, options, recommendations = [], value, chooseFromList = false }: MultiSelectProps) {
  const [query, setQuery] = useState('')
  const inputId = useId()
  const names = useMemo(() => new Map(options.map((option) => [option.id, option.label])), [options])
  const available = options.filter((option) => !value.includes(option.id) && option.label.toLocaleLowerCase('zh-TW').includes(query.trim().toLocaleLowerCase('zh-TW')))
  const add = (id: string) => { if (!value.includes(id)) onChange([...value, id]); setQuery('') }
  return <fieldset className="multi-select"><legend>{label}</legend>
    <div className="multi-select-values">{value.map((id) => <button aria-label={`移除${names.get(id) ?? id}`} key={id} onClick={() => onChange(value.filter((item) => item !== id))} type="button"><Tag kind={kind}>{names.get(id) ?? id} ×</Tag></button>)}</div>
    {recommendations.some((item) => !value.includes(item.id)) && <div className="multi-select-recommendations"><span>常用</span>{recommendations.filter((item) => !value.includes(item.id)).map((item) => <Button key={item.id} size="small" variant="ghost" onClick={() => add(item.id)}>{item.label}</Button>)}</div>}
    {chooseFromList && <label><span className="sr-only">選擇{label}</span><select aria-label={`選擇${label}`} value="" onChange={event => { if (event.target.value) add(event.target.value) }}><option value="">選擇{label}（可複選、可留空）</option>{options.filter(item => !value.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
    <label className="sr-only" htmlFor={inputId}>搜尋{label}</label><input id={inputId} placeholder={`搜尋${label}`} value={query} onChange={(event) => setQuery(event.target.value)} />
    {query && <div className="multi-select-options" role="listbox">{available.length ? available.map((option) => <button key={option.id} onClick={() => add(option.id)} role="option" type="button">{option.label}</button>) : <span>沒有符合的既有項目</span>}</div>}
  </fieldset>
}
