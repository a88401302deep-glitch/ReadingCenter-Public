export const navigationItems = [
  { id: 'reading', label: '閱讀' },
  { id: 'library', label: '書庫' },
  { id: 'notes', label: '閱讀筆記' },
  { id: 'management', label: '管理' }
] as const
export type NavigationId = (typeof navigationItems)[number]['id']
export function isNavigationId(value: string): value is NavigationId { return navigationItems.some(item => item.id === value) }
