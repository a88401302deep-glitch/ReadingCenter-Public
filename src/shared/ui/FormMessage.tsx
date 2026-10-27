import type { ReactNode } from 'react'
interface FormMessageProps { children: ReactNode; tone?: 'error' | 'info' }
export function FormMessage({ children, tone = 'info' }: FormMessageProps) {
  return <p className={`form-message form-message--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>{children}</p>
}
