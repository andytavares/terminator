import type { SessionEvent } from '../events/session-event.js'
import type {
  DiffSummary,
  PendingPermission,
  RuntimeState,
} from '../../../shared/types/supervision.js'

// A pure reducer: (state, event) -> state. No clock, no I/O, no mutation.
// Every consumer downstream — the stall detector, the review queue, the
// surfaces — reads what this produces, so keeping it side-effect free is what
// makes the whole subsystem testable without fakes (Constitution XI).

export interface SessionFailure {
  readonly step: 'setup' | 'agent'
  readonly exitCode: number | null
  readonly output: string
}

export interface SessionState {
  readonly sessionId: string
  readonly runtimeState: RuntimeState
  readonly stateSince: number
  readonly transcriptPath: string | null
  readonly lastToolActivityAt: number | null
  readonly lastNetChangeAt: number | null
  /** Set while a shell call is in flight, so the detector can exclude it (FR-015). */
  readonly openShellCallId: string | null
  readonly openShellStartedAt: number | null
  readonly turns: number
  readonly costUsd: number
  readonly contextPct: number | null
  readonly pendingPermission: PendingPermission | null
  readonly diffSummary: DiffSummary
  readonly failure: SessionFailure | null
}

export function initialSessionState(sessionId: string, at: number): SessionState {
  return {
    sessionId,
    // Provisioning runs before the agent does, so a session is `starting`
    // before it is anything else.
    runtimeState: 'starting',
    stateSince: at,
    transcriptPath: null,
    lastToolActivityAt: null,
    lastNetChangeAt: null,
    openShellCallId: null,
    openShellStartedAt: null,
    turns: 0,
    costUsd: 0,
    contextPct: null,
    pendingPermission: null,
    diffSummary: { files: 0, added: 0, removed: 0 },
    failure: null,
  }
}

/** Only moves `stateSince` when the state genuinely changed. */
function transition(state: SessionState, to: RuntimeState, at: number): SessionState {
  if (state.runtimeState === to) return state
  return { ...state, runtimeState: to, stateSince: at }
}

export function applyEvent(state: SessionState, event: SessionEvent): SessionState {
  // Events are fanned out on one bus, so a session only reduces its own.
  if (event.sessionId !== state.sessionId) return state

  switch (event.kind) {
    case 'setup_finished':
      return event.exitCode === 0
        ? state
        : {
            ...transition(state, 'failed', event.at),
            failure: { step: 'setup', exitCode: event.exitCode, output: event.output },
          }

    case 'session_started':
      return { ...transition(state, 'working', event.at), transcriptPath: event.transcriptPath }

    case 'permission_requested':
      return {
        ...transition(state, 'needs_input', event.at),
        pendingPermission: {
          requestId: event.requestId,
          toolName: event.toolName,
          summary: event.summary,
          detail: event.detail ?? null,
          options: event.options,
          targetHost: event.targetHost,
          requestedAt: event.at,
        },
      }

    case 'permission_resolved':
      // A resolution for a request we are not waiting on is stale — ignore it
      // rather than clearing a live prompt.
      if (state.pendingPermission?.requestId !== event.requestId) return state
      return { ...transition(state, 'working', event.at), pendingPermission: null }

    case 'tool_started':
      return {
        ...transition(state, 'working', event.at),
        lastToolActivityAt: event.at,
        openShellCallId: event.isShell ? event.callId : state.openShellCallId,
        openShellStartedAt: event.isShell ? event.at : state.openShellStartedAt,
      }

    case 'tool_finished': {
      const closesOpenShell = state.openShellCallId === event.callId
      return {
        ...state,
        lastToolActivityAt: event.at,
        openShellCallId: closesOpenShell ? null : state.openShellCallId,
        openShellStartedAt: closesOpenShell ? null : state.openShellStartedAt,
      }
    }

    case 'turn_finished':
      return {
        ...state,
        turns: event.turns,
        costUsd: event.costUsd,
        contextPct: event.contextPct,
      }

    case 'session_ended': {
      if (event.outcome === 'error') {
        return {
          ...transition(state, 'failed', event.at),
          failure: { step: 'agent', exitCode: null, output: event.reason ?? '' },
        }
      }
      // A session that changed nothing is terminal but has nothing to review,
      // so it must not enter the review queue (FR-045).
      // A session that changed nothing is terminal but has nothing to review,
      // so it must not enter the review queue (FR-045) — and it is not a
      // merge either: no branch reached the trunk. Calling it `merged` would
      // unblock downstream lanes waiting on a change that was never made.
      if (state.diffSummary.files > 0) return transition(state, 'ready', event.at)
      return {
        ...transition(state, 'failed', event.at),
        failure: { step: 'agent', exitCode: null, output: 'finished without changing anything' },
      }
    }

    case 'branch_merged':
      return transition(state, 'merged', event.at)
  }
}
