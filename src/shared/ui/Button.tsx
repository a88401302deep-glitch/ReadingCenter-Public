import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Icon } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'edit'
export type ButtonSize = 'small' | 'medium'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  leadingIcon?: ReactNode
}

export function Button({
  children,
  className = '',
  leadingIcon,
  size = 'medium',
  type = 'button',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`button button--${variant} button--${size} ${className}`.trim()}
      type={type}
      {...props}
    >
      {leadingIcon ?? (variant === 'edit' ? <Icon name="editNote" size={16} /> : null)}
      <span>{children}</span>
    </button>
  )
}
