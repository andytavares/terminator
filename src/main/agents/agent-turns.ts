// Whether each terminal's agent is mid-turn, from its UserPromptSubmit and Stop hooks. A terminal
// that never reported is absent: the window then falls back to guessing from output.

export type TurnListener = (sessionId: string, inTurn: boolean) => void

const turns = new Map<string, boolean>()
const listeners = new Set<TurnListener>()

export function onTurnChange(listener: TurnListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Every terminal that has reported a turn, for a window that opens after one did. */
export function currentTurns(): Array<{ sessionId: string; inTurn: boolean }> {
  return [...turns].map(([sessionId, inTurn]) => ({ sessionId, inTurn }))
}

export function setTurn(sessionId: string, inTurn: boolean): void {
  if (turns.get(sessionId) === inTurn) return
  turns.set(sessionId, inTurn)
  for (const listener of listeners) listener(sessionId, inTurn)
}
