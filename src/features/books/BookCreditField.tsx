import { useLayoutEffect, useRef, type RefObject } from 'react'

interface Props { label: string; value: string; onChange: (value: string) => void; required?: boolean; maxLength?: number; inputRef?: RefObject<HTMLTextAreaElement | null> }
function fitTextArea(input: HTMLTextAreaElement | null) {
 if (!input) return
 input.style.height = 'auto'
 input.style.height = `${Math.max(44, input.scrollHeight + 2)}px`
}
export function BookCreditField({ label, value, onChange, required = false, maxLength = 4000, inputRef }: Props) {
 const ownRef = useRef<HTMLTextAreaElement>(null)
 const ref = inputRef ?? ownRef
 useLayoutEffect(() => {
  fitTextArea(ref.current)
  if (typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(() => fitTextArea(ref.current))
  if (ref.current?.parentElement) observer.observe(ref.current.parentElement)
  return () => observer.disconnect()
 }, [ref, value])
 return <div className="book-field" data-long={value.length > 64 || value.split('\n').length > 3 ? true : undefined}><span className="field-requirement" aria-hidden="true">{required ? '必填' : '選填'}</span><label><span className="field-caption">{label.replace('（每行一位）', '')}</span><textarea ref={ref} aria-label={label} required={required} title={required ? undefined : label} rows={1} maxLength={required ? undefined : maxLength} value={value} onFocus={event => fitTextArea(event.currentTarget)} onChange={event => onChange(event.target.value)} /></label></div>
}
