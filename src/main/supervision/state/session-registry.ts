import type { SessionEvent } from '../events/session-event.js'
import { applyEvent, initialSessionState, type SessionState } from './state-machine.js'
import type { AutonomyLevel, SupervisedSession } from '../../../shared/types/supervision.js'

// Holds every supervised session, persists on change, and re-adopts what it can
// on restart. The interesting requirement is FR-009: a session that was
// mid-flight when the console died must come back as `unknown`, never as
// `working`. Reporting stale confidence is worse than reporting nothing.

export interface SessionMeta {
  workItemId: string | null
  laneOrd: number | null
  repoPath: string
  worktreePath: string
  branch: string
  autonomyLevel: AutonomyLevel
}

interface PersistedEntry {
  meta: SessionMeta
  state: SessionState
  lastViewedAt: number | null
}

/** Minimal slice of electron-store, so the registry can be tested without it. */
export interface RegistryStore {
  get(): unknown
  set(value: unknown): void
}

export interface SessionRegistryOptions {
  store: RegistryStore
  now: () => number
}

export interface SessionRegistry {
  register(sessionId: string, meta: SessionMeta): void
  apply(event: SessionEvent): void
  get(sessionId: string): SupervisedSession | null
  list(): SupervisedSession[]
  markViewed(sessionId: string, at: number): void
}

/** States that a restart cannot invalidate, because nothing further will happen to them. */
const TERMINAL: ReadonlySet<string> = new Set(['failed', 'ready', 'merged'])

function isEntry(value: unknown): value is PersistedEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.meta === 'object' && entry.meta !== null && typeof entry.state === 'object'
}

function load(store: RegistryStore, now: number): Map<string, PersistedEntry> {
  const raw = store.get()
  const entries = new Map<string, PersistedEntry>()
  if (typeof raw !== 'object' || raw === null) return entries

  for (const [sessionId, value] of Object.entries(raw as Record<string, unknown>)) {
    // A corrupt entry costs that one session, not the registry.
    if (!isEntry(value)) continue
    const settled = TERMINAL.has(value.state.runtimeState)
    entries.set(sessionId, {
      ...value,
      state: settled
        ? value.state
        : {
            // No evidence yet that it is still running. The tailer may promote
            // it back once it has read the transcript.
            ...value.state,
            runtimeState: 'unknown',
            stateSince: now,
            // The callback that would answer this prompt died with the driver,
            // so leaving it on screen would be a lie.
            pendingPermission: null,
          },
    })
  }
  return entries
}

function project(sessionId: string, entry: PersistedEntry): SupervisedSession {
  const { meta, state } = entry
  return {
    id: sessionId,
    workItemId: meta.workItemId,
    laneOrd: meta.laneOrd,
    repoPath: meta.repoPath,
    worktreePath: meta.worktreePath,
    branch: meta.branch,
    transcriptPath: state.transcriptPath,
    runtimeState: state.runtimeState,
    stateSince: state.stateSince,
    lastToolActivityAt: state.lastToolActivityAt,
    lastNetChangeAt: state.lastNetChangeAt,
    openShellCallId: state.openShellCallId,
    turns: state.turns,
    costUsd: state.costUsd,
    contextPct: state.contextPct,
    pendingPermission: state.pendingPermission,
    diffSummary: state.diffSummary,
    autonomyLevel: meta.autonomyLevel,
    lastViewedAt: entry.lastViewedAt,
  }
}

export function createSessionRegistry(options: SessionRegistryOptions): SessionRegistry {
  const { store, now } = options
  const entries = load(store, now())

  function persist(): void {
    store.set(Object.fromEntries(entries))
  }

  return {
    register(sessionId: string, meta: SessionMeta): void {
      entries.set(sessionId, {
        meta,
        state: initialSessionState(sessionId, now()),
        lastViewedAt: null,
      })
      persist()
    },

    apply(event: SessionEvent): void {
      const entry = entries.get(event.sessionId)
      // An event for a session we never registered is not ours to materialise.
      if (entry === undefined) return
      const next = applyEvent(entry.state, event)
      if (next === entry.state) return
      entries.set(event.sessionId, { ...entry, state: next })
      persist()
    },

    get(sessionId: string): SupervisedSession | null {
      const entry = entries.get(sessionId)
      return entry === undefined ? null : project(sessionId, entry)
    },

    list(): SupervisedSession[] {
      return [...entries].map(([sessionId, entry]) => project(sessionId, entry))
    },

    markViewed(sessionId: string, at: number): void {
      const entry = entries.get(sessionId)
      if (entry === undefined) return
      entries.set(sessionId, { ...entry, lastViewedAt: at })
      persist()
    },
  }
}
