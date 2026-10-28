interface IconProps {
  name: 'arrowRight' | 'book' | 'chevronDown' | 'close' | 'logOut' | 'plus' | 'search' | 'library' | 'settings' | 'grid' | 'list' | 'filter' | 'journalExit' | 'journalTools' | 'editNote' | 'deleteNote'
  className?: string
  size?: number
}

export function Icon({ name, size = 18, className = '' }: IconProps) {
  const paths = {
    editNote: <><path d="m5 16.8 10.9-12 3.6 3.1-11 12-4.1.6.6-3.7ZM13.8 7.1l3.6 3.1M5 16.8l3.5 3.1" /><path d="m4.4 21 7-.2" /></>,
    deleteNote: <><path d="m4.7 7.1 14.6-.2M9 4.3l5.7.1.8 2.6M6.4 7.2l.8 12.5 9.7.1.7-12.6M10 10.5l.3 6.4M14 10.4l-.1 6.5" /></>,
    journalExit: <><path d="M10.3 3.9 4.7 5.1l-.2 14 5.8 1.1.2-16.3ZM10.6 5l6.2.2.1 4.1M16.8 15.3l-.1 3.4-6.2.2M13.2 12.1l7.2-.2m-2.7-2.7 3 2.6-2.7 3" /><path d="m7.9 12.1.1.1" /><path d="m3 3 .8.5M2.1 6l.8-.1" /></>,
    journalTools: <><path d="m5.4 17.7 10-11 2.7-1.3 1.5 1.4-1 2.8-10.3 11-3.5.5.6-3.4ZM14.6 7.6l3 2.5M5.4 17.7l2.9 2.9M4 8.5l4.4-.2M6 6.2l.2 4.5" /><path d="m18.4 15.7.2 4.2M16.5 17.8l4.1-.1M11 3.1l.2 1.3" /></>,
    filter: <><path d="M3 6h18M6 12h12M9 18h6" /><circle cx="8" cy="6" r="2" /><circle cx="16" cy="12" r="2" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    list: <><path d="M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1" /></>,
    library: <><path d="M3 20.5h18M4 5.5l4-.3.4 13.3-4 .3L4 5.5ZM10.5 4l3.6.2-.4 14.3-3.6-.1.4-14.4ZM16 6l3.4-.7 2.4 13-3.5.6L16 6ZM5 9h2M11 8h2" /></>,
    settings: <><path d="M4 7.3 20 7M4 17l16.2.3" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    arrowRight: <path d="M5 12h14m-5-5 5 5-5 5" />,
    book: <path d="M12 6c-3-2-6-2.5-10-1.5l.7 14c3.3-.9 6.3-.4 9.3 1.5m0-14c3-2 6-2.5 10-1.5l-.7 14c-3.3-.9-6.3-.4-9.3 1.5V6ZM5 8.5c1.4-.2 2.5 0 4 .6M5.2 12c1.3-.2 2.5.1 3.8.6M15 9c1.4-.5 2.5-.6 4-.5M15 12.5c1.3-.4 2.5-.5 3.8-.4" />,
    chevronDown: <path d="m7 9.5 5 5 5-5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    logOut: <path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" />,
    plus: <path d="M12 5v14M5 12h14" />,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>
  }

  const solidPaths: Partial<typeof paths> = {
    book: <path d="M3 4c3-1 6-.5 8 1v15c-2-1.5-5-2-8-1a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm18 0c-3-1-6-.5-8 1v15c2-1.5 5-2 8-1a1 1 0 0 0 1-1V5a1 1 0 0 0-1-1Z" />,
    library: <path d="M4 3h3a1 1 0 0 1 1 1v15H3V4a1 1 0 0 1 1-1Zm6 2h3a1 1 0 0 1 1 1v13H9V6a1 1 0 0 1 1-1Zm6-2 3-.7a1 1 0 0 1 1.2.8l2.5 15-5 .8-2.5-14.7A1 1 0 0 1 16 3ZM2 20h21v2H2Z" />,
    list: <path fillRule="evenodd" d="M6 2h10l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm9 2v5h5l-5-5ZM8 12v2h9v-2H8Zm0 5v2h7v-2H8Z" />,
    editNote: <path d="m15 3 5 5-12 12-6 2 2-6L15 3Zm2-2 2-1a2 2 0 0 1 2 0l3 3a2 2 0 0 1 0 2l-2 2-5-6Z" />,
    journalTools: <path fillRule="evenodd" d="M10 2h4l1 2.5 2 1.2 2.8-.4 2 3.4-1.8 2v2.6l1.8 2-2 3.4-2.8-.4-2 1.2-1 2.5h-4l-1-2.5-2-1.2-2.8.4-2-3.4 1.8-2v-2.6l-1.8-2 2-3.4 2.8.4 2-1.2 1-2.5ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
    settings: <path fillRule="evenodd" d="M2 5h20v3H2V5Zm0 11h20v3H2v-3ZM8 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 11a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />,
    grid: <path d="M3 2h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Zm12 0h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM3 14h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Zm12 0h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z" />
  }
  const solid = solidPaths[name]
  return (
    <svg aria-hidden="true" focusable="false" className={`icon${solid ? ' icon--solid' : ''} ${className}`.trim()} fill={solid ? 'currentColor' : 'none'} height={size} viewBox="0 0 24 24" width={size}>
      {solid ?? paths[name]}
    </svg>
  )
}
