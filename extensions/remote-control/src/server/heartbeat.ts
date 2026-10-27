import type WebSocket from 'ws'

export const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Ping the socket every interval; terminate it when the last ping got no pong.
 * A phone that left the network sends no close frame, so without this its
 * viewer slot stays taken. Pattern: https://github.com/websockets/ws#how-to-detect-and-close-broken-connections
 */
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
