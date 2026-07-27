import { create } from 'zustand'
import type { RuntimeState, SupervisedSession } from '../../shared/types/supervision.js'
import {
  rankAttention,
  summariseStatus,
  type AttentionItem,
} from '../../shared/supervision/rank-attention.js'
import type { StatusSummary } from '../../shared/schemas/supervision.js'

// Renderer-side mirror of the session registry. Read-only by construction:
// runtime state is derived from observed agent activity in the main process, so
// nothing here ever asserts a state — the surfaces render what was observed.
//
// `rankAttention` and `summariseStatus` are imported rather than reimplemented.
// The Attention Queue, the feed and the palette are three renderings of one
// query, and forking it per surface is how they drift apart.

export interface StateChange {
  sessionId: string
  to: RuntimeState
  at: number
}

/** Injected so the store is testable without the preload bridge. */
export interface SupervisionTransport {
  listSessions(): Promise<SupervisedSession[]>
}

interface SupervisionState {
  sessions: SupervisedSession[]
  /** Distinguishes "no sessions" from "not asked yet" — the empty state must assert, not imply. */
  loaded: boolean
  load(transport: SupervisionTransport): Promise<void>
  applyStateChange(change: StateChange): void
  attention(now: number): AttentionItem[]
  statusSummary(now: number): StatusSummary
  byId(sessionId: string): SupervisedSession | null
}

export const useSupervisionStore = create<SupervisionState>((set, get) => ({
  sessions: [],
  loaded: false,

  async load(transport: SupervisionTransport): Promise<void> {
    try {
      set({ sessions: await transport.listSessions(), loaded: true })
    } catch {
      // A failed refresh must not blank a surface the operator is reading.
      // Stale state is recoverable; an empty screen that means "I don't know"
      // is indistinguishable from "everything is fine", which is the exact
      // confusion this feature exists to remove.
    }
  },

  applyStateChange(change: StateChange): void {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === change.sessionId
          ? { ...session, runtimeState: change.to, stateSince: change.at }
          : session
      ),
    }))
  },

  attention(now: number): AttentionItem[] {
    return rankAttention(get().sessions, now)
  },

  statusSummary(now: number): StatusSummary {
    return summariseStatus(get().sessions, now)
  },

  byId(sessionId: string): SupervisedSession | null {
    return get().sessions.find((session) => session.id === sessionId) ?? null
  },
}))
