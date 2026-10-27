import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string
  children: ReactNode
  tone?: 'default' | 'danger'
}

export function IconButton({
  children,
  className = '',
  tone = 'default',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      className={`icon-button icon-button--${tone} ${className}`.trim()}
      type={type}
      {...props}
    >
      {children}
    </button>
  )
}
