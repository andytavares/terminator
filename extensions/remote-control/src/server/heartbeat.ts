import type WebSocket from 'ws'

/** @internal */
export const HEARTBEAT_INTERVAL_MS = 30_000

/** Ping every interval; terminate when the last ping got no pong. A phone that left the network
 * sends no close frame, so its viewer slot would stay taken. */
export function watchForBrokenConnection(ws: WebSocket): void {
  let answered = true
  ws.on('pong', () => {
    answered = true
  })
  const timer = setInterval(() => {
    if (!answered) {
      ws.terminate()
      return
    }
    answered = false
    ws.ping()
  }, HEARTBEAT_INTERVAL_MS)
  ws.on('close', () => clearInterval(timer))
}
