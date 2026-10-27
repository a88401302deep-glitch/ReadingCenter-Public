import { useCallback, useEffect, useId, useRef, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import { IconButton } from './IconButton'

export type ModalCloseReason = 'closeButton' | 'escape' | 'backdrop'

interface ModalProps {
  children: ReactNode
  hasUnsavedChanges?: boolean
  open: boolean
  title: string
  trapFocus?: boolean
  onClose: (reason: ModalCloseReason) => void
  confirmDiscard?: () => boolean
}

export function Modal({
  children,
  confirmDiscard,
  hasUnsavedChanges = false,
  onClose,
  open,
  title,
  trapFocus = false
}: ModalProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(null)

  const requestClose = useCallback((reason: ModalCloseReason) => {
    const mayClose =
      !hasUnsavedChanges ||
      (confirmDiscard ?? (() => window.confirm('尚有未儲存的變更，確定要離開嗎？')))()

    if (mayClose) onClose(reason)
  }, [confirmDiscard, hasUnsavedChanges, onClose])

  const requestCloseRef = useRef(requestClose)
  useEffect(() => { requestCloseRef.current = requestClose }, [requestClose])

  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement as HTMLElement | null
    document.body.classList.add('modal-open')
    panelRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && trapFocus) {
        const panel = panelRef.current
        const controls = panel ? Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')).filter(control => !control.closest('[hidden], [inert], fieldset[disabled]') && getComputedStyle(control).display !== 'none') : []
        const first = controls[0], last = controls[controls.length - 1]
        if (!first) { event.preventDefault(); panel?.focus({ preventScroll: true }) }
        else if (document.activeElement === panel || !panel?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true }) }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus({ preventScroll: true }) }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus({ preventScroll: true }) }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        requestCloseRef.current('escape')
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.body.classList.remove('modal-open')
      document.removeEventListener('keydown', onKeyDown)
      previousFocus.current?.focus({ preventScroll: true })
    }
  }, [open, trapFocus])

  if (!open) return null

  const onBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) requestClose('backdrop')
  }

  return createPortal(
    <div className="modal-backdrop" data-testid="modal-backdrop" onMouseDown={onBackdropClick}>
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal-panel"
        ref={panelRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <IconButton aria-label="關閉" onClick={() => requestClose('closeButton')}>
            <Icon name="close" />
          </IconButton>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body
  )
}
