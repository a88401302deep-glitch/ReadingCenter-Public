/** Only fixed codes and numeric HTTP status may cross the API boundary. */
export type MetadataProvider = '讀書共和國' | '台灣角川' | 'Open Library' | 'Google Books' | 'Pubu'
export type LookupFailureKind = 'http' | 'network' | 'timeout' | 'format' | 'maintenance'
export interface MetadataDiagnostic { source: MetadataProvider; status: 'ok' | 'empty' | 'failed' | 'disabled'; count: number; kind?: LookupFailureKind; httpStatus?: number }
export function metadataDiagnosticMessages(value: unknown): string[] {
 if (!Array.isArray(value)) return []
 const sources = ['讀書共和國', '台灣角川', 'Open Library', 'Google Books', 'Pubu']
 return value.slice(0, 5).flatMap(item => {
  if (!item || typeof item !== 'object') return []
  const row = item as Record<string, unknown>
  if (!sources.includes(String(row.source))) return []
  const source = String(row.source)
  if (row.status === 'disabled') return [source + '：未啟用']
  if (row.status === 'ok' && Number.isSafeInteger(row.count) && Number(row.count) >= 0 && Number(row.count) <= 100) return [source + '：取得 ' + row.count + ' 筆候選']
  if (row.status === 'empty') return [source + '：查詢成功，沒有候選']
  if (row.status !== 'failed') return []
  if (row.kind === 'http' && Number.isInteger(row.httpStatus) && Number(row.httpStatus) >= 100 && Number(row.httpStatus) <= 599) return [source + '：HTTP ' + row.httpStatus]
  return [source + '：' + (row.kind === 'maintenance' ? '官方維護中' : row.kind === 'timeout' ? '回應逾時' : row.kind === 'network' ? '連線失敗' : row.kind === 'format' ? '回應格式無法辨識' : '來源失敗')]
 })
}
