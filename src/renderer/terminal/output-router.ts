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

/** One session's output, through one shared `terminal:output` listener kept for the page's life,
 * which also acknowledges output nobody subscribes to. The handler calls `written` once xterm took
 * the data, which lets main pause a process that outruns the renderer (flow control). */
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
