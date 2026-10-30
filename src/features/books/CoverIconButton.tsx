import type { ButtonHTMLAttributes, ComponentProps } from 'react'
import { Button } from '../../shared/ui/Button'
import { Icon } from '../../shared/ui/Icon'

export function CoverIconButton({ label, icon, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: ComponentProps<typeof Icon>['name'] }) {
  return <Button {...props} aria-label={props['aria-label'] ?? label} className="cover-icon-button">
    <Icon name={icon} size={21} />
    <span className="cover-action-tooltip" role="tooltip">{label}</span>
  </Button>
}
