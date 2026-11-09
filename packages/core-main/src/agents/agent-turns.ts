// Whether each terminal's agent is mid-turn, from its UserPromptSubmit and Stop hooks. A terminal
// that never reported is absent: the window then falls back to guessing from output.

export type TurnListener = (sessionId: string, inTurn: boolean) => void

/** Each terminal's turn, and when its last turn ended: a window that reloads still knows. */
const turns = new Map<string, { inTurn: boolean; endedAt: number | null }>()
const listeners = new Set<TurnListener>()

export function onTurnChange(listener: TurnListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Every terminal that has reported a turn, for a window that opens after one did. */
export function currentTurns(): Array<{
  sessionId: string
  inTurn: boolean
  endedAt: number | null
}> {
  return [...turns].map(([sessionId, turn]) => ({ sessionId, ...turn }))
}

export function setTurn(sessionId: string, inTurn: boolean, now = Date.now()): void {
  const before = turns.get(sessionId)
  if (before?.inTurn === inTurn) return
  const endedAt = before?.inTurn === true && !inTurn ? now : (before?.endedAt ?? null)
  turns.set(sessionId, { inTurn, endedAt })
  for (const listener of listeners) listener(sessionId, inTurn)
}

/** Ends a turn in progress; a terminal not in one is left alone, so a shell's Esc changes nothing. */
export function endTurn(sessionId: string): void {
  if (turns.get(sessionId)?.inTurn === true) setTurn(sessionId, false)
}

/** The terminal is gone: forget its turn, and tell listeners it is no longer in one. */
export function clearTurn(sessionId: string): void {
  if (!turns.delete(sessionId)) return
  for (const listener of listeners) listener(sessionId, false)
}
