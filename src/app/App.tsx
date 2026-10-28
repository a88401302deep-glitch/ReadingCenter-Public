import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getBookDisplayTitle, type Book, type BookCollection, type DictionaryEntry, type ReadingCycle, type ReadingRecord, type SourceReadingDay } from '../domain'
import { createIndexedDbRepositories } from '../data'
import { useAuth } from '../features/auth/auth-context'
import { useCloudSync } from '../features/sync/use-cloud-sync'
import { SyncManager } from '../features/sync/SyncManager'
import { LibraryTools, type LibraryTask } from '../features/import/LibraryTools'
import { HeaderReadingSummary } from '../features/reading-overview/HeaderReadingSummary'
import { BookForm } from '../features/books/BookForm'
import { BookService, type BookDeletionImpact, type BookDraft } from '../features/books/book-service'
import { recommendBookTerms } from '../features/books/book-recommendations'
import { BookDetail } from '../features/library/BookDetail'
import { libraryBookReadings, type LibraryReadingStatus } from '../features/library/library-book-summary'
import { LibraryCatalog } from '../features/library/LibraryCatalog'
import { ReadingNotes } from '../features/library/ReadingNotes'
import { ReadingCycleService } from '../features/reading-cycles/reading-cycle-service'
import { ReadingRecordService } from '../features/reading-records/reading-record-service'
import { ReadingContentService } from '../features/reading-contents/reading-content-service'
import { QuickProgressService } from '../features/reading-overview/quick-progress-service'
import { ReadingDashboard } from '../features/reading-overview/ReadingDashboard'
import { ReadingOverviewService } from '../features/reading-overview/reading-overview-service'
import { Button } from '../shared/ui/Button'
import { Header } from '../shared/ui/Header'
import { Icon } from '../shared/ui/Icon'
import { Popover } from '../shared/ui/Popover'
import { Modal } from '../shared/ui/Modal'
import type { NavigationId } from './navigation'
import '../features/books/books.css'
import '../features/reading-overview/reading-overview.css'

const localData = createIndexedDbRepositories()
const pageTitles: Record<NavigationId, string> = { reading: '閱讀', library: '書庫', notes: '閱讀筆記', management: '管理' }

export function App() {
  const { authEnabled, localAccess = authEnabled, logout } = useAuth()
  const cloudSync = useCloudSync(localAccess, authEnabled)
  const repositories = cloudSync.repositories ?? localData.repositories
  const service = useMemo(() => new BookService(repositories), [repositories])
  const cycleService = useMemo(() => new ReadingCycleService(repositories), [repositories])
  const progressService = useMemo(() => new QuickProgressService(repositories), [repositories])
  const recordService = useMemo(() => new ReadingRecordService(repositories), [repositories])
  const contentService = useMemo(() => new ReadingContentService(repositories), [repositories])
  const overviewService = useMemo(() => new ReadingOverviewService(repositories), [repositories])
  const [active, setActive] = useState<NavigationId>('reading')
  const [managementTask, setManagementTask] = useState<LibraryTask>('home')
  const [syncPreview, setSyncPreview] = useState(false)
  const [contentRevision, setContentRevision] = useState(0)
  const [readingRevision, setReadingRevision] = useState(0)
  const [books, setBooks] = useState<Book[]>([])
  const [catalogCycles, setCatalogCycles] = useState<ReadingCycle[]>([])
  const [catalogSourceDays, setCatalogSourceDays] = useState<SourceReadingDay[]>([])
  const [catalogRecords, setCatalogRecords] = useState<ReadingRecord[]>([])
  const [catalogReadingLoaded, setCatalogReadingLoaded] = useState(false)
  const [collections, setCollections] = useState<BookCollection[]>([])
  const [dictionaries, setDictionaries] = useState<DictionaryEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Book | null | undefined>(undefined)
  const [bookFormDirty, setBookFormDirty] = useState(false)
  const [coverPending, setCoverPending] = useState(false)
  const [deleting, setDeleting] = useState<Book | null>(null)
  const [detailBook, setDetailBook] = useState<Book | null>(null)
  const detailScrollTop = useRef(0)
  const [impact, setImpact] = useState<BookDeletionImpact | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reload = async () => setBooks(await service.list())
  const mayLeaveEditor = () => !busy && !coverPending && (!bookFormDirty || window.confirm('尚有未儲存的變更，確定要離開嗎？'))
  const clearEditor = () => { setEditing(undefined); setBookFormDirty(false); setError(null) }
  useEffect(() => {
    if (!bookFormDirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [bookFormDirty])
  const navigate = (page: NavigationId) => { if (page !== active && !mayLeaveEditor()) return; if (page !== active) { clearEditor(); window.scrollTo({ top: 0 }) }; setManagementTask('home'); setSyncPreview(false); setActive(page) }
  useEffect(() => {
    let cancelled = false
    void Promise.all([service.list(), repositories.dictionaries.getAll(), repositories.readingCycles.getAll(), repositories.readingRecords.getAll(), repositories.sourceReadingDays.getAll(), repositories.collections.getAll()])
      .then(([items, entries, cycles, records, sourceDays, groups]) => { if (!cancelled) { setCollections(groups); setBooks(items); setDictionaries(entries); setCatalogCycles(cycles); setCatalogRecords(records); setCatalogSourceDays(sourceDays); setCatalogReadingLoaded(true); setLoadError(null) } })
      .catch(() => { if (!cancelled) setLoadError('無法載入書庫資料') })
    return () => { cancelled = true }
  }, [service, repositories, cloudSync.revision, readingRevision])

  const save = async (draft: BookDraft) => {
    setBusy(true); setError(null)
    try {
      if (editing) await service.update(editing.id, draft, editing.revision)
      else await service.create(draft)
      await reload(); setReadingRevision((value) => value + 1); setBookFormDirty(false); setEditing(undefined); setActive('library')
    } catch (reason) { setError(reason instanceof Error ? reason.message : '無法儲存書籍') }
    finally { setBusy(false) }
  }
  const requestDelete = async (book: Book) => { if (!mayLeaveEditor()) return; clearEditor(); setDeleting(book); setImpact(await service.deletionImpact(book.id)) }
  const openCreate = () => { if (!mayLeaveEditor()) return; clearEditor(); setManagementTask('add'); setSyncPreview(false); setActive('management') }
  const restoreLibraryPosition = useCallback(() => requestAnimationFrame(() => window.scrollTo({ top: detailScrollTop.current })), [])
  const openDetail = (book: Book) => {
    if (!mayLeaveEditor()) return
    clearEditor()
    detailScrollTop.current = window.scrollY
    window.history.pushState({ ...window.history.state, readingCenterBookId: book.id }, '')
    setError(null)
    setDetailBook(book)
  }
  const closeDetail = () => {
    setBookFormDirty(false)
    setError(null)
    if (window.history.state?.readingCenterBookId) window.history.back()
    else { setDetailBook(null); restoreLibraryPosition() }
  }
  const saveDetail = async (draft: BookDraft, expectedRevision: number): Promise<Book | null> => {
    if (!detailBook) return null
    setBusy(true); setError(null)
    try { const updated = await service.update(detailBook.id, draft, expectedRevision); await reload(); setReadingRevision(value => value + 1); setDetailBook(updated); return updated }
    catch (reason) { setError(reason instanceof Error ? reason.message : '無法儲存書籍'); return null }
    finally { setBusy(false) }
  }
  const changeReadingStatus = async (status: Exclude<LibraryReadingStatus, 'unknown'>) => {
    if (!detailBook || busy) return
    setBusy(true); setError(null)
    try {
      const latest = (await cycleService.listForBook(detailBook.id)).at(-1)
      if (latest) await cycleService.update(latest.id, { ...latest, status }, latest.revision)
      else await cycleService.create(detailBook.id, { status })
      setReadingRevision(value => value + 1)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '無法儲存閱讀狀態') }
    finally { setBusy(false) }
  }
  useEffect(() => {
    const onPopState = () => {
      if (detailBook && (busy || coverPending || bookFormDirty && !window.confirm('尚有未儲存的變更，確定要離開嗎？'))) {
        window.history.pushState({ ...window.history.state, readingCenterBookId: detailBook.id }, '')
        return
      }
      setBookFormDirty(false); setDetailBook(null); restoreLibraryPosition()
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [restoreLibraryPosition, detailBook, bookFormDirty, busy, coverPending])
  const confirmDelete = async () => {
    if (!deleting) return
    setBusy(true); setError(null)
    try { await service.delete(deleting.id); await reload(); setReadingRevision((value) => value + 1); setContentRevision((value) => value + 1); setDeleting(null); setImpact(null) }
    catch (reason) { setError(reason instanceof Error ? reason.message : '無法刪除書籍') }
    finally { setBusy(false) }
  }

  return <div className={`app-shell${active === 'reading' ? ' is-reading-overview' : ''}`}>
    <Header active={active} summary={<HeaderReadingSummary service={overviewService} revision={readingRevision + contentRevision + cloudSync.revision} />} sync={<div className="header-sync">{localAccess && <Popover label="同步狀態" trigger={props => <button type="button" className={`sync-indicator${cloudSync.syncing ? ' is-syncing' : cloudSync.message === '已同步。' ? ' is-synced' : ' needs-attention'}`} aria-label={`同步狀態：${cloudSync.syncing ? '正在同步…' : cloudSync.message}`} title={cloudSync.syncing ? '正在同步…' : cloudSync.message} {...props}><span aria-hidden="true" className="sync-dot" /><span className="sync-status sr-only" role="status">{cloudSync.syncing ? '正在同步…' : cloudSync.message}</span></button>} content={<><p>{cloudSync.syncing ? '正在同步…' : cloudSync.message}</p>{cloudSync.local && <Button onClick={() => { navigate('management'); setSyncPreview(true) }}>核對同步問題</Button>}</>} />}</div>} onLogout={localAccess ? () => { if (mayLeaveEditor()) void logout() } : undefined} onNavigate={navigate} />
    <main id="main" className="page-shell">
      {active !== 'reading' && active !== 'library' && <div className="page-heading"><h1>{pageTitles[active]}</h1></div>}
      <button className="floating-create" aria-label="新增書籍" title="新增書籍" type="button" onClick={openCreate}><Icon name="plus" size={25} /></button>
      {active === 'reading' && <ReadingDashboard progressService={progressService} onProgressChanged={() => setReadingRevision(value => value + 1)} onOpenBook={openDetail} revision={readingRevision + contentRevision + cloudSync.revision} service={overviewService} />}
      {active === 'library' && <LibraryCatalog books={books} dictionaries={dictionaries} cycles={catalogCycles} records={catalogRecords} sourceDays={catalogSourceDays} readingLoaded={catalogReadingLoaded} loadError={loadError} onOpen={openDetail} />}
      {active === 'notes' && <ReadingNotes books={books} onChanged={() => setContentRevision(value => value + 1)} onOpenBook={openDetail} revision={contentRevision + cloudSync.revision} service={contentService} />}
      {active === 'management' && (syncPreview ? <SyncManager local={authEnabled ? cloudSync.local : null} message={cloudSync.message} syncing={cloudSync.syncing} onRetry={cloudSync.retry} onResolved={cloudSync.onResolved} onBack={() => setSyncPreview(false)} /> : <LibraryTools task={managementTask} onTask={setManagementTask} onManual={() => { setError(null); setBookFormDirty(false); setEditing(null) }} repositories={repositories} restoreLocal={cloudSync.local ?? undefined} onChanged={() => { setReadingRevision(value => value + 1); setContentRevision(value => value + 1) }} />)}
    </main>
    <Modal hasUnsavedChanges={bookFormDirty} open={editing === null} title={editing ? '編輯書籍' : '新增書籍'} onClose={() => { setBookFormDirty(false); setEditing(undefined) }}><BookForm books={books} book={editing ?? undefined} busy={busy} dictionaries={dictionaries} collections={collections} categoryRecommendations={recommendBookTerms(books, dictionaries, 'category')} tagRecommendations={recommendBookTerms(books, dictionaries, 'tag')} error={error} onCancel={() => { if (busy || bookFormDirty && !window.confirm('尚有未儲存的變更，確定要離開嗎？')) return; setBookFormDirty(false); setEditing(undefined) }} onDirtyChange={setBookFormDirty} onSubmit={save} /></Modal>
    <Modal hasUnsavedChanges={bookFormDirty || busy || coverPending} confirmDiscard={mayLeaveEditor} open={detailBook !== null} title={detailBook ? `《${getBookDisplayTitle(detailBook)}》` : '單書頁'} onClose={closeDetail}>{detailBook && <BookDetail onCoverPendingChange={setCoverPending} onStatusChange={changeReadingStatus} onDirtyChange={setBookFormDirty} readingStatus={libraryBookReadings([detailBook], catalogCycles, catalogRecords, catalogSourceDays).get(detailBook.id)?.status} onDelete={book => { closeDetail(); void requestDelete(book) }} syncRevision={cloudSync.revision} book={detailBook} books={books} busy={busy || coverPending} contentService={contentService} cycleService={cycleService} dictionaries={dictionaries} collections={collections} error={error} onContentChanged={() => setContentRevision((value) => value + 1)} onReadingChanged={() => setReadingRevision((value) => value + 1)} onSave={saveDetail} overviewService={overviewService} readingRevision={readingRevision + cloudSync.revision} recordService={recordService} />}</Modal>
    <Modal open={deleting !== null} title="刪除書籍" onClose={() => { setDeleting(null); setImpact(null) }}><div className="delete-confirmation"><p>確定刪除《{deleting ? getBookDisplayTitle(deleting) : ''}》？此操作同時移除：</p><ul><li>{impact?.readingCycles ?? 0} 個閱讀週期</li><li>{impact?.readingRecords ?? 0} 筆閱讀紀錄</li><li>{impact?.readingContents ?? 0} 筆閱讀內容</li></ul>{error && <p className="form-message form-message--error" role="alert">{error}</p>}<div className="form-actions"><Button onClick={() => setDeleting(null)}>取消</Button><Button disabled={busy} variant="danger" onClick={() => void confirmDelete()}>確認刪除</Button></div></div></Modal>
  </div>
}




