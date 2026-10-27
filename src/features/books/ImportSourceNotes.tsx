export function ImportSourceNotes({ notes }: { notes?: string }) {
  if (!notes) return null
  return <details className="import-source-notes">
    <summary>匯入來源資料</summary>
    <p>原始欄位與搬遷提醒保留於此，與書籍備註分開。</p>
    <pre>{notes}</pre>
  </details>
}
