import { useEffect, useRef, useState, type ClipboardEvent } from 'react'
import { Button } from '../../shared/ui/Button'
import { validateCoverFile } from './book-cover-upload'

export function BookCoverPaste({ disabled, onSelect }: { disabled: boolean; onSelect: (file: File) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  function select(file: File) {
    validateCoverFile(file)
    onSelect(file)
    setError('')
  }
  function paste(event: ClipboardEvent<HTMLTextAreaElement>) {
    event.preventDefault()
    if (disabled || busy) return
    try {
      const file = Array.from(event.clipboardData.files).find(item => item.type.startsWith('image/'))
      if (!file) throw new Error('沒有收到圖片，請使用「複製圖片」，不是複製圖片網址。')
      select(file)
    } catch (reason) { setError(reason instanceof Error ? reason.message : '無法貼上圖片') }
  }
  async function readClipboard() {
    if (disabled || busy) return
    const current = ++generation.current
    setBusy(true); setError('')
    try {
      if (!navigator.clipboard?.read) throw new Error('此瀏覽器無法使用按鈕貼上，請在下方欄位貼上圖片，或選擇檔案。')
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const type = item.types.find(type => ['image/png', 'image/jpeg', 'image/webp'].includes(type))
        if (!type) continue
        const blob = await item.getType(type)
        if (current === generation.current) select(new File([blob], '貼上封面', { type }))
        return
      }
      throw new Error('剪貼簿沒有支援的圖片，請先複製圖片本身。')
    } catch (reason) {
      if (current === generation.current) setError(reason instanceof Error && reason.name !== 'NotAllowedError' ? reason.message : '未能讀取剪貼簿，請允許貼上，或在下方欄位貼上圖片。')
    } finally { if (current === generation.current) setBusy(false) }
  }
  return <div className="book-cover-paste">
    <Button disabled={disabled || busy} onClick={() => void readClipboard()}>{busy ? '讀取圖片中' : '貼上封面'}</Button>
    <label>圖片貼上區<textarea rows={1} readOnly disabled={disabled || busy} placeholder="複製圖片後，在此貼上（電腦可按 Ctrl＋V）" onPaste={paste} /></label>
    {error && <p role="alert">{error}</p>}
  </div>
}
