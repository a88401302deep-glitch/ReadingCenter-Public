import { lazy, Suspense } from 'react'
import type { ReadingCenterRepositories, SyncingLocalRepositoryContext } from '../../data'
import { Button, Icon } from '../../shared/ui'
import { BackupExport } from '../backup/BackupExport'
import { BackupPreview } from '../backup/BackupPreview'
const MoonBackupPreview = lazy(() => import('./MoonBackupPreview').then(m => ({ default: m.MoonBackupPreview })))
const PhotoBookImport = lazy(() => import('./PhotoBookImport').then(m => ({ default: m.PhotoBookImport })))
const SpreadsheetImport = lazy(() => import('./SpreadsheetImport').then(m => ({ default: m.SpreadsheetImport })))
export type LibraryTask = 'home' | 'add' | 'backup' | 'restore' | 'moon' | 'photo' | 'sheet'
export function LibraryTools({ task, onTask, onManual, repositories, restoreLocal, onChanged }: { task: LibraryTask; onTask: (task: LibraryTask) => void; onManual: () => void; repositories: ReadingCenterRepositories; restoreLocal?: SyncingLocalRepositoryContext; onChanged: () => void }) {
 const back = () => onTask('add')
 if (task === 'moon') return <Suspense fallback={<p role="status">正在載入匯入功能…</p>}><MoonBackupPreview repositories={repositories} onBack={back} /></Suspense>
 if (task === 'photo') return <Suspense fallback={<p role="status">正在載入截圖功能…</p>}><PhotoBookImport repositories={repositories} onChanged={onChanged} onBack={back} /></Suspense>
 if (task === 'sheet') return <Suspense fallback={<p role="status">正在載入表格匯入…</p>}><SpreadsheetImport repositories={repositories} onChanged={onChanged} onBack={back} /></Suspense>
 if (task === 'backup' || task === 'restore') return <><Button variant="ghost" onClick={() => onTask('home')}>返回管理</Button>{task === 'backup' ? <BackupExport repositories={repositories} /> : <BackupPreview repositories={repositories} local={restoreLocal} onRestored={onChanged} />}</>
 if (task === 'add') return <section aria-label="新增書目" className="add-book-hub"><div className="journal-heading"><h2>把下一本書放進來</h2></div><div className="management-grid">{[['moon', '匯入備份檔', '靜讀天下的書籍與閱讀紀錄'], ['photo', '截圖', '從照片或閱讀截圖開始'], ['sheet', 'Excel', '匯入 XLSX 或 CSV 書籍清單'], ['manual', '輸入書名', '搜尋資料或自行新增']].map(([id, label, detail]) => <button key={id} aria-label={label} type="button" onClick={() => id === 'manual' ? onManual() : onTask(id as LibraryTask)}><span><strong>{label}</strong><small>{detail}</small></span><Icon name="arrowRight" /></button>)}</div><Button variant="ghost" onClick={() => onTask('home')}>返回管理</Button></section>
 return <section className="management-grid" aria-label="管理功能"><button type="button" aria-label="選擇新增方式" onClick={() => onTask('add')}><span><strong>新增書籍</strong><small>備份檔、截圖、Excel、書名</small></span><Icon name="plus" /></button><button type="button" aria-label="備份資料庫" onClick={() => onTask('backup')}><span><strong>備份資料庫</strong><small>下載目前的書庫與閱讀紀錄</small></span><Icon name="book" /></button><button type="button" aria-label="匯入資料庫" onClick={() => onTask('restore')}><span><strong>匯入資料庫</strong><small>從閱讀中心備份核對並還原</small></span><Icon name="library" /></button></section>
}
