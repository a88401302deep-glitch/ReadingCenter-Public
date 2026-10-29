import type { ReactNode, Ref } from 'react'
import type { NavigationId } from '../../app/navigation'
import { navigationItems } from '../../app/navigation'
import { Icon } from './Icon'
import { IconButton } from './IconButton'
import { EntryIcon } from './EntryIcon'
interface HeaderProps { toolbarRef?: Ref<HTMLDivElement>; active: NavigationId; onLogout?: () => void; onNavigate: (id: NavigationId) => void; summary?: ReactNode; sync?: ReactNode }
export function Header({ toolbarRef, active, onLogout, onNavigate, summary, sync }: HeaderProps) {
 return <header className="site-header">
  <div className="header-reading-summary">{summary}</div>
  <nav aria-label="主要導覽" className="primary-nav">{navigationItems.filter(item => item.id !== 'management').map(item => <button aria-label={item.label} title={item.label} aria-current={active === item.id ? 'page' : undefined} className="nav-item" key={item.id} onClick={() => onNavigate(item.id)} type="button"><EntryIcon name={item.id} /><span className="nav-label">{item.label}</span></button>)}</nav>
  {active === 'library' && <div className="header-library-tools" ref={toolbarRef} />}
  <div className="header-actions">{sync}{onLogout && <IconButton aria-label="登出" title="登出" onClick={onLogout}><Icon name="logOut" size={22} /></IconButton>}<IconButton aria-label="管理" aria-current={active === 'management' ? 'page' : undefined} onClick={() => onNavigate('management')}><Icon name="journalTools" size={24} /></IconButton></div>
 </header>
}
