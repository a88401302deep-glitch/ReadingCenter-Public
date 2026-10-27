let previous: Promise<void> = Promise.resolve()

export function withCloudSyncLock<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request('reading-center-cloud-sync', { signal }, operation)
  }
  // Serializes the current app when Web Locks is unavailable. Cross-tab locking
  // still requires Web Locks; local transactions and server revisions remain enforced.
  const run = () => { signal?.throwIfAborted(); return operation() }
  const next = previous.then(run, run)
  previous = next.then(() => undefined, () => undefined)
  return next
}
