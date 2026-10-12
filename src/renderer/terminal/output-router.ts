type OutputHandler = (data: string, written: () => void) => void

const subscribers = new Map<string, OutputHandler>()
let listening = false

function route(sessionId: string, data: string): void {
  const acknowledge = (): void => window.electronAPI.terminal.acknowledge(sessionId, data.length)
  const handler = subscribers.get(sessionId)
  // Output with nowhere to go is acknowledged at once: main would otherwise wait
  // for a renderer that will never write it.
  if (handler) handler(data, acknowledge)
  else acknowledge()
}

/**
 * Receive the output of one session. All sessions share one `terminal:output`
 * listener, installed with the first subscriber and kept for the life of the
 * page, so N terminals cost one IPC handler rather than N handlers each
 * filtering by id, and output for a session that has no subscriber is still
 * acknowledged.
 * The handler calls `written` once xterm has taken the data, which is what lets
 * main pause a process that outruns the renderer (flow control).
 */
export function subscribeToSessionOutput(sessionId: string, handler: OutputHandler): () => void {
  if (!listening) {
    window.electronAPI.terminal.onOutput(route)
    listening = true
  }
  subscribers.set(sessionId, handler)
  return () => {
    if (subscribers.get(sessionId) === handler) subscribers.delete(sessionId)
  }
}
