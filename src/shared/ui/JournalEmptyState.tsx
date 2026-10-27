interface JournalEmptyStateProps {
  title: string
  detail?: string
  busy?: boolean
}

export function JournalEmptyState({ title, detail, busy = false }: JournalEmptyStateProps) {
  return <div className="journal-empty" data-busy={busy} role={busy ? 'status' : undefined}>
    <svg className="journal-empty-art" aria-hidden="true" focusable="false" viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="38" cy="65" rx="29" ry="5" fill="var(--paper-deep)" stroke="none" />
      <path d="M15 36c10 2 29 2 40 0l-3 18c-1 8-7 11-17 11s-16-4-17-11l-3-18Z" fill="var(--surface-raised)" />
      <path d="M55 39c17-3 15 17-3 16M22 43c8 2 18 2 26 0M12 67h49" />
      <path className="tea-steam" d="M26 28c-6-7 6-9 1-17M39 28c-6-7 6-9 1-17M51 28c-5-6 5-8 1-14" />
      <path d="m64 19 1.7 4.3L70 25l-4.3 1.7L64 31l-1.7-4.3L58 25l4.3-1.7Z" fill="var(--sunshine)" stroke="none" />
      <path d="M29 52c1 2 3 2 4 0M39 52c1 2 3 2 4 0M34 57c1 1 3 1 4 0" />
    </svg>
    <div><p>{title}</p>{detail && <small>{detail}</small>}</div>
  </div>
}
