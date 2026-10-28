import { ReadingContentDate } from './ReadingContentDate'
import { useEffect, useState, type FormEvent } from 'react'
import type { ReadingContent, ReadingContentType, ReadingCycle } from '../../domain'
import { Button, FormMessage, Icon } from '../../shared/ui'
import { ReadingContentService, type ReadingContentDraft } from './reading-content-service'

interface Props { browseFirst?: boolean; heading?: string; revision?: number; bookId: string; cycles: ReadingCycle[]; onChanged?: () => void; service: ReadingContentService }
const typeLabel: Record<ReadingContentType, string> = { highlight: '畫線', shortReview: '短評', longReview: '長篇心得' }
const toInput = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}
const toIso = (value: string) => value ? new Date(value).toISOString() : null

export function ReadingContentManager({ browseFirst = false, heading = '閱讀內容', revision = 0, bookId, cycles, onChanged, service }: Props) {
  const [managing, setManaging] = useState(false)
  const showActions = !browseFirst || managing
  const [contents, setContents] = useState<ReadingContent[]>([])
  const [editing, setEditing] = useState<ReadingContent | null | undefined>(undefined)
  const [deleting, setDeleting] = useState<ReadingContent | null>(null)
  const [type, setType] = useState<ReadingContentType>('shortReview')
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [locator, setLocator] = useState('')
  const [title, setTitle] = useState('')
  const [cycleId, setCycleId] = useState('')
  const [recordedForAt, setRecordedForAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const reload = async () => setContents(await service.listForBook(bookId))

  useEffect(() => {
    let cancelled = false
    void service.listForBook(bookId).then((items) => { if (!cancelled) setContents(items) })
    return () => { cancelled = true }
  }, [bookId, service, revision])

  const openForm = (content: ReadingContent | null, nextType: ReadingContentType = 'shortReview') => {
    setEditing(content)
    setType(content?.type ?? nextType)
    setText(content?.text ?? '')
    setNote(content?.type === 'highlight' ? content.note ?? '' : '')
    setLocator(content?.type === 'highlight' ? content.locator ?? '' : '')
    setTitle(content?.type === 'longReview' ? content.title ?? '' : '')
    setCycleId(content?.cycleId ?? '')
    setRecordedForAt(toInput(content?.recordedForAt ?? null))
    setError(null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    const contentTime = editing && recordedForAt === toInput(editing.recordedForAt) ? editing.recordedForAt : toIso(recordedForAt)
    const base = { cycleId: cycleId || null, recordedForAt: contentTime, text }
    const draft: ReadingContentDraft = type === 'highlight'
      ? { ...base, type, note, locator }
      : type === 'longReview' ? { ...base, type, title } : { ...base, type }
    try {
      if (editing) await service.update(editing.id, draft, editing.revision)
      else await service.create(bookId, draft)
      await reload()
      onChanged?.()
      setEditing(undefined)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '無法儲存閱讀內容') }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    try { await service.delete(deleting.id); await reload(); onChanged?.(); setDeleting(null) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '無法刪除閱讀內容') }
  }

  return <section className="reading-content-manager" aria-label={heading}>
    <div className="section-heading"><h3>{heading === '閱讀心得' && <Icon name="editNote" />}{heading}</h3>{browseFirst && <Button className="management-action" size="small" aria-pressed={managing} disabled={editing !== undefined || deleting !== null} onClick={() => setManaging(value => !value)}>{managing ? '完成心得管理' : '管理心得'}</Button>}{showActions && <div className="content-heading-actions">
      {contents.some((item) => item.type === 'longReview') && <span className="long-review-marker">有長文</span>}
      <Button size="small" onClick={() => openForm(null, 'highlight')}>畫線</Button>
      <Button size="small" onClick={() => openForm(null, 'shortReview')}>短評</Button>
      <Button size="small" onClick={() => openForm(null, 'longReview')}>長篇心得</Button>
    </div>}</div>
    {contents.length === 0 ? <p className="empty-line">尚無閱讀內容</p> : <ol className="reading-content-list">{contents.map((content) => <li key={content.id}>
      <div className="content-meta"><span>{typeLabel[content.type]}</span><ReadingContentDate content={content} cycles={cycles} />{content.cycleId && <small>第 {cycles.find((cycle) => cycle.id === content.cycleId)?.sequence ?? '—'} 次閱讀</small>}</div>
      {content.type === 'longReview' && content.title && <strong>{content.title}</strong>}
      <p>{content.text}</p>
      {content.type === 'highlight' && content.note && <p className="highlight-note">{content.note}</p>}
      {content.type === 'highlight' && content.locator && <small>{content.locator}</small>}
      {showActions && <div className="content-row-actions"><Button size="small" onClick={() => openForm(content)}>編輯</Button><Button size="small" variant="danger" onClick={() => setDeleting(content)}>刪除</Button></div>}
    </li>)}</ol>}
    {editing !== undefined && <form className="entity-form content-form" onSubmit={submit}>
      <label>類型<select disabled={editing !== null} value={type} onChange={(event) => setType(event.target.value as ReadingContentType)}>{Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      {type === 'longReview' && <label>標題<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>}
      <label>{typeLabel[type]}內容<textarea autoFocus required rows={type === 'longReview' ? 9 : 4} value={text} onChange={(event) => setText(event.target.value)} /></label>
      {type === 'highlight' && <><label>附註<textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label><label>位置<input placeholder="章節、頁碼或進度" value={locator} onChange={(event) => setLocator(event.target.value)} /></label></>}
      <div className="content-context-fields"><label>閱讀週期<select value={cycleId} onChange={(event) => setCycleId(event.target.value)}><option value="">不指定</option>{cycles.map((cycle) => <option key={cycle.id} value={cycle.id}>第 {cycle.sequence} 次閱讀</option>)}</select></label><label>內容時間<input type="datetime-local" value={recordedForAt} onChange={(event) => setRecordedForAt(event.target.value)} /></label></div>
      {error && <FormMessage tone="error">{error}</FormMessage>}
      <div className="form-actions"><Button onClick={() => setEditing(undefined)}>取消</Button><Button type="submit" variant="primary">儲存</Button></div>
    </form>}
    {deleting && <div className="delete-confirmation content-delete-confirmation"><p>確定刪除這筆{typeLabel[deleting.type]}？</p><div className="form-actions"><Button onClick={() => setDeleting(null)}>取消</Button><Button variant="danger" onClick={() => void confirmDelete()}>確認刪除</Button></div></div>}
  </section>
}
