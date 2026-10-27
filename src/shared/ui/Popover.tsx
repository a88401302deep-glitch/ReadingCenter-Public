import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

interface PopoverTriggerProps {
  'aria-controls': string
  'aria-expanded': boolean
  'aria-haspopup': 'dialog'
  onClick: () => void
}

interface PopoverProps {
  content: ReactNode
  label: string
  trigger: (props: PopoverTriggerProps) => ReactNode
}

export function Popover({ content, label, trigger }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const contentId = useId()

  useEffect(() => {
    if (!open) return
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="popover" ref={rootRef}>
      {trigger({
        'aria-controls': contentId,
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        onClick: () => setOpen((value) => !value)
      })}
      {open && (
        <div aria-label={label} className="popover-panel" id={contentId} role="dialog">
          {content}
        </div>
      )}
    </div>
  )
}
