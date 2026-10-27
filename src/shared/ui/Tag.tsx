import type { HTMLAttributes } from 'react'

export type TagKind = 'category' | 'tag' | 'source' | 'neutral'

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  kind?: TagKind
}

export function Tag({ children, className = '', kind = 'neutral', ...props }: TagProps) {
  return (
    <span className={`tag tag--${kind} ${className}`.trim()} {...props}>
      {children}
    </span>
  )
}
