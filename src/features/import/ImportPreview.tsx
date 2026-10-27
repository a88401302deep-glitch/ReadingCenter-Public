import { lazy, Suspense, useState, type ComponentProps } from 'react'
import type { ReadingCenterRepositories, SyncingLocalRepositoryContext } from '../../data'
import { NotionCsvPreview } from './NotionCsvPreview'
import { BackupExport } from '../backup/BackupExport'
import { BackupPreview } from '../backup/BackupPreview'
const MoonBackupPreview = lazy(() => import('./MoonBackupPreview').then(module => ({ default: module.MoonBackupPreview })))
const PhotoBookImport = lazy(() => import('./PhotoBookImport').then(module => ({ default: module.PhotoBookImport })))
export function ImportPreview(props: Omit<ComponentProps<typeof NotionCsvPreview>, 'repositories'> & { repositories: ReadingCenterRepositories; restoreLocal?: SyncingLocalRepositoryContext; onRestored?: () => void }) {
  const [source, setSource] = useState<'notion' | 'moon' | 'photo'>('notion')
  if (source === 'photo') return <Suspense fallback={<p role="status">載入拍照辨識…</p>}><PhotoBookImport repositories={props.repositories} onChanged={props.onRestored} onBack={() => setSource('notion')} /></Suspense>
  if (source === 'moon') return <Suspense fallback={<p role="status">載入備份預覽…</p>}><MoonBackupPreview repositories={props.repositories} onBack={() => setSource('notion')} /></Suspense>
  return <><BackupExport repositories={props.repositories} /><BackupPreview repositories={props.repositories} local={props.restoreLocal} onRestored={props.onRestored} /><div className="form-actions"><button type="button" onClick={() => setSource('moon')}>靜讀天下備份預覽</button><button type="button" onClick={() => setSource('photo')}>拍照／截圖辨識書名</button></div><NotionCsvPreview {...props} /></>
}

