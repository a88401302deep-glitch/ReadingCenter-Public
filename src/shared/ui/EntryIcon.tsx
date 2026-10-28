import { Icon } from './Icon'

export function EntryIcon({ name }: { name: 'reading' | 'library' | 'notes' | 'add' }) {
  const icons = { reading: 'book', library: 'library', notes: 'list', add: 'plus' } as const
  return <Icon className={`entry-icon entry-icon--${name}`} name={icons[name]} size={28} />
}
