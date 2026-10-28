interface EntryIconProps {
  name: 'reading' | 'library' | 'notes' | 'add'
}

/** Decorative artwork; the surrounding button supplies the accessible name. */
export function EntryIcon({ name }: EntryIconProps) {
  return <svg aria-hidden="true" focusable="false" className={`entry-icon entry-icon--${name}`} viewBox="0 0 40 40" width="30" height="30" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <circle className="entry-icon-shadow" cx="20" cy="21.5" r="18" />
    <circle className="entry-icon-disc" cx="20" cy="19" r="18" />
    <path className="entry-icon-glint" d="M8 13a14 14 0 0 1 13-8" />
    {name === 'reading' && <g className="entry-icon-art">
      <path className="entry-icon-spine" d="M8 13.5q6-2 12 1 6-3 12-1v15q-6-2-12 1-6-3-12-1Z" />
      <path className="entry-icon-page" d="M8 11q6-2 12 1 6-3 12-1v15q-6-2-12 1-6-3-12-1Z" />
      <path d="M20 12v15M11.5 16q2.5-.3 5 1M11.5 20q2.5-.3 5 1M23.5 17q2.5-1.3 5-1" />
      <path className="entry-icon-ribbon" d="M25 10v9l2-1.5 2 1.5v-9" />
    </g>}
    {name === 'library' && <g className="entry-icon-art">
      <path className="entry-icon-spine" d="M7 29h27v3H7Z" />
      <rect className="entry-icon-book" x="9" y="10" width="6" height="18" rx="2" />
      <rect className="entry-icon-page" x="16" y="8" width="6" height="20" rx="2" />
      <path className="entry-icon-book" d="m24 12 4-1a1.5 1.5 0 0 1 2 1l3 14q.3 1.5-1 1.8l-4 1q-1.5.3-1.8-1Z" />
      <path d="M11 14h2M18 12h2M18 24h2m6-8 3-.7" />
    </g>}
    {name === 'notes' && <g className="entry-icon-art">
      <rect className="entry-icon-spine" x="10" y="10" width="20" height="22" rx="4" />
      <rect className="entry-icon-page" x="9" y="8" width="20" height="22" rx="4" />
      <path className="entry-icon-book" d="M9 12a4 4 0 0 1 4-4h2v22h-2a4 4 0 0 1-4-4Z" />
      <path d="M19 15h6M19 19h6M19 23h3M11 13h4M11 19h4M11 25h4" />
      <path className="entry-icon-ribbon" d="M24 8v6l2-1 2 1V8" />
    </g>}
    {name === 'add' && <path className="entry-icon-plus" d="M20 11v16M12 19h16" />}
  </svg>
}
