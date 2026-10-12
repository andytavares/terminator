const subscribers = new Map<string, (data: string) => void>()
let removeListener: (() => void) | null = null

function route(sessionId: string, data: string): void {
  subscribers.get(sessionId)?.(data)
}

/**
 * Receive the output of one session. All sessions share one `terminal:output`
 * listener, installed with the first subscriber and removed with the last, so N
 * terminals cost one IPC handler rather than N handlers each filtering by id.
 */
export function subscribeToSessionOutput(
  sessionId: string,
  handler: (data: string) => void
): () => void {
  if (!removeListener) removeListener = window.electronAPI.terminal.onOutput(route)
  subscribers.set(sessionId, handler)
  return () => {
    if (subscribers.get(sessionId) === handler) subscribers.delete(sessionId)
    if (subscribers.size === 0) {
      removeListener?.()
      removeListener = null
    }
  }
}
