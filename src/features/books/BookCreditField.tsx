import { useCallback, useLayoutEffect, useRef } from 'react'

interface Props { label: string; value: string; onChange: (value: string) => void }
export function BookCreditField({ label, value, onChange }: Props) {
 const ref = useRef<HTMLTextAreaElement>(null)
 const fit = useCallback(() => {
  const input = ref.current
  if (!input) return
  input.style.height = 'auto'
  input.style.height = `${Math.max(44, Math.min(input.scrollHeight + 2, 192))}px`
 }, [])
 useLayoutEffect(() => {
  fit()
  // The native editor dialog becomes visible after child layout effects.
  // Refit when it opens or the available width changes.
  if (typeof ResizeObserver === 'undefined') return
  const observer = new ResizeObserver(fit)
  if (ref.current?.parentElement) observer.observe(ref.current.parentElement)
  return () => observer.disconnect()
 }, [fit, value])
 return <div className="book-field"><span className="field-requirement" aria-hidden="true">選填</span><label><span className="field-caption">{label}</span><textarea ref={ref} rows={1} maxLength={4000} value={value} onFocus={fit} onChange={event => onChange(event.target.value)} /></label></div>
}
