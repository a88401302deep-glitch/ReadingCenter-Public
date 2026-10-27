export interface D1Result<T = unknown> {
  results?: T[]
  success: boolean
  meta: { changes?: number }
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement
}

export interface CoverKV {
  get(key: string, type: 'arrayBuffer'): Promise<ArrayBuffer | null>
  put(key: string, value: ArrayBuffer): Promise<void>
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>
}
