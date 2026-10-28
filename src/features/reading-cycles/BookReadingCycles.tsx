import type { ReadingCycle, ReadingRecord, ReadingProgress } from '../../domain'
import { Button } from '../../shared/ui'
import { ReadingRecordPopover } from '../reading-records/ReadingRecordPopover'
import type { ReadingRecordService } from '../reading-records/reading-record-service'
import { readingProgressLabel } from '../reading-overview/book-reading-days'
import { cycleProgress } from '../reading-overview/cycle-progress'
import { cycleDateLabel, statusLabel } from './reading-cycle-labels'

interface Props {
  showActions?: boolean
  onRecordEditingChange?: (cycleId: string | null, active: boolean) => void
  cycles: ReadingCycle[]
  records: ReadingRecord[]
  bookId: string
  revision: number
  recordService: ReadingRecordService
  onRecordsChanged: () => void
  onEdit: (cycle: ReadingCycle | null) => void
  onComplete?: (cycle: ReadingCycle) => void
  onDelete: (cycle: ReadingCycle) => void
}
const progressLabel = (progress: ReadingProgress | null | undefined) => progress?.unit === 'position' ? `${progress.value} ${progress.label || '位置'}` : readingProgressLabel(progress)
const dateLabel = (value: string | null) => value?.replace('T', ' ').slice(0, 16) ?? '未記錄'
function RecordDetails({ records, label }: { records: ReadingRecord[]; label: string }) {
  if (records.length === 0) return null
  return <section className="cycle-record-details" aria-label={label}><h5>{label}（{records.length}）</h5>
    <dl className="cycle-record-rows">{records.map(record => <div key={record.id}>
      <dt><time dateTime={record.startedAt}>{dateLabel(record.startedAt)}</time></dt>
      <dd>{progressLabel(record.progress)}{record.durationMinutes !== null ? ` · ${record.durationMinutes} 分鐘` : ''}</dd>
    </div>)}</dl>
  </section>
}
export function BookReadingCycles({ showActions = true, onRecordEditingChange, cycles, records, bookId, revision, recordService, onRecordsChanged, onEdit, onDelete, onComplete }: Props) {
  const entries = (cycleId: string | null) => records.filter(record => record.cycleId === cycleId).sort((a, b) => b.startedAt.localeCompare(a.startedAt))
  const unassigned = entries(null)
  const unmatched = records.filter(record => record.cycleId !== null && !cycles.some(cycle => cycle.id === record.cycleId))
  return <div className="book-reading-cycles">
    {(cycles.length > 0 || showActions) && <div className="section-heading"><h4>每次閱讀</h4>{showActions && <Button className="create-action" size="small" onClick={() => onEdit(null)}>新增一次閱讀</Button>}</div>}
    {cycles.length > 0 && <ol className="cycle-list cycle-list--grouped">{cycles.map(cycle => {
      const ownRecords = entries(cycle.id)
      const progress = cycleProgress(cycle, ownRecords)
      const completion = cycle.completionDate ? cycleDateLabel(cycle).replace(/^完讀(?:日期範圍)?：/, '') : cycle.status === 'completed' ? dateLabel(cycle.finishedAt) : '尚未完讀'
      return <li key={cycle.id}><section className="reading-cycle-group" aria-label={`第 ${cycle.sequence} 次閱讀`}>
        <div className="reading-cycle-heading"><h4>第 {cycle.sequence} 次閱讀</h4><span>{statusLabel[cycle.status]}</span></div>
        <dl className="cycle-facts">
          <div><dt>開始閱讀</dt><dd>{cycle.startedAt ? dateLabel(cycle.startedAt) : cycle.startedOn ?? '未記錄'}</dd></div>
          {cycle.lastReadOn && <div><dt>最後閱讀日</dt><dd><time dateTime={cycle.lastReadOn}>{cycle.lastReadOn}</time></dd></div>}
          <div><dt>{cycle.completionDate?.precision === 'range' ? '完讀日期範圍' : '完讀日期'}</dt><dd>{completion}</dd></div>
          <div><dt>進度</dt><dd>{progressLabel(progress)}</dd></div>
          <div><dt>累計時長</dt><dd>{cycle.reportedDurationMinutes == null ? '未記錄' : `${cycle.reportedDurationMinutes} 分鐘`}</dd></div>
          <div><dt>閱讀天數</dt><dd>{cycle.reportedReadingDays == null ? '未記錄' : `${cycle.reportedReadingDays} 天`}</dd></div>
        </dl>
        <RecordDetails records={ownRecords} label={`第 ${cycle.sequence} 次閱讀明細`} />
        {showActions && <div className="cycle-heading-actions"><ReadingRecordPopover onEditingChange={onRecordEditingChange} onMarkCompleted={cycle.status !== 'completed' && onComplete ? () => onComplete(cycle) : undefined} triggerLabel="更新閱讀紀錄" revision={revision} bookId={bookId} cycleId={cycle.id} cycleSequence={cycle.sequence} service={recordService} onChanged={onRecordsChanged} /><Button size="small" onClick={() => onEdit(cycle)}>編輯本次閱讀</Button><Button size="small" variant="danger" onClick={() => onDelete(cycle)}>刪除本次閱讀</Button></div>}
      </section></li>
    })}</ol>}
    {(unassigned.length > 0 || showActions && cycles.length === 0) && <section className="reading-cycle-group reading-cycle-unassigned" aria-label="未分次紀錄">
      <div className="reading-cycle-heading"><h4>未分次紀錄</h4>{showActions && <ReadingRecordPopover onEditingChange={onRecordEditingChange} triggerLabel="更新未分次紀錄" revision={revision} bookId={bookId} cycleId={null} service={recordService} onChanged={onRecordsChanged} />}</div>
      <RecordDetails records={unassigned} label="未分次閱讀明細" />
    </section>}
    {unmatched.length > 0 && <section className="reading-cycle-group" aria-label="待核對紀錄"><h4>待核對紀錄</h4><RecordDetails records={unmatched} label="待核對閱讀明細" /></section>}
  </div>
}
