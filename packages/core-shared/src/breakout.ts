// A breakout window is a window.open child of the main window holding one terminal session.
// Its frame name carries the session id, which is how the main process tells it apart from
// any other window.open and knows which session it holds.

const FRAME_PREFIX = 'terminator-session:'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function breakoutFrameName(sessionId: string): string {
  return `${FRAME_PREFIX}${sessionId}`
}

/** The session a breakout frame name was made for, or null for any other frame name. */
export function sessionIdOfFrameName(frameName: string): string | null {
  if (!frameName.startsWith(FRAME_PREFIX)) return null
  const sessionId = frameName.slice(FRAME_PREFIX.length)
  return UUID.test(sessionId) ? sessionId : null
}
