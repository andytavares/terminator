import type { PendingPermission } from './permission-bridge.js'

// What is waiting on the operator right now, across every card.
//
// The runner raises a request and clears it again; something has to hold the
// ones in between, or the surface has nothing to render and a phase blocks at
// its hook until the console hands the decision back to the terminal.
//
// Deliberately not a second session registry. A supervised run belongs to a
// card, so requests are keyed by the card's feature directory — the identifier
// the board, the phases and the worktree already use.

export interface PendingAsk extends PendingPermission {
  /** The card the run belongs to. */
  readonly featureDir: string
}

export interface PendingPermissions {
  add(ask: PendingAsk): void
  /** Removes one, answered or handed back. */
  remove(requestId: string): void
  /** Everything outstanding, oldest first — the order they must be answered in. */
  list(): PendingAsk[]
  /** Everything outstanding for one card. */
  forCard(featureDir: string): PendingAsk[]
  /** The run a request belongs to, so the answer is sent to the right one. */
  sessionFor(requestId: string): string | null
  /** Drops a whole card's requests, when its run ends. */
  forgetCard(featureDir: string): void
}

export function createPendingPermissions(): PendingPermissions {
  // Insertion-ordered, which is also age order: a Map preserves it, and the
  // operator answering oldest-first is what stops a run being starved by
  // whichever card happened to ask most recently.
  const asks = new Map<string, PendingAsk>()

  return {
    add(ask: PendingAsk): void {
      asks.set(ask.requestId, ask)
    },

    remove(requestId: string): void {
      asks.delete(requestId)
    },

    list(): PendingAsk[] {
      return [...asks.values()]
    },

    forCard(featureDir: string): PendingAsk[] {
      return [...asks.values()].filter((ask) => ask.featureDir === featureDir)
    },

    sessionFor(requestId: string): string | null {
      return asks.get(requestId)?.sessionId ?? null
    },

    forgetCard(featureDir: string): void {
      for (const [requestId, ask] of asks) {
        if (ask.featureDir === featureDir) asks.delete(requestId)
      }
    },
  }
}
