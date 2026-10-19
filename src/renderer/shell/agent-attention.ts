import { useEffect } from 'react'
import { useSessionStore } from '../stores/session.store'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionRecordsStore } from '../stores/session-records.store'
import { useIntegrationsStore } from '../stores/integrations.store'
import { agentStateOf } from '../sidebar/agent-state'
import { buildSessionFacts } from '../sidebar/session-facts'
import type { AgentState, TerminalSession } from '../../shared/types/index'

// What the window tells main about how much its agents need you: the questions
// agents raise (shown on the session), and each change of a session's state
// (kept in the attention log).

/** A state must hold this long before it is reported: busy flips on every burst of output. */
export const SETTLE_MS = 2000

export interface StateReport {
  sessionId: string
  projectId: string | null
  branch: string | null
  workKey: string | null
  state: AgentState
  at: string
}

const currentIsoTime = (): string => new Date().toISOString()

/** Where the session runs and which ticket it serves, as Home shows them. */
function reportOf(session: TerminalSession, state: AgentState, at: string): StateReport {
  const workspaceState = useWorkspaceStore.getState()
  const [facts] = buildSessionFacts({
    sessions: [session],
    records: [...useSessionRecordsStore.getState().records.values()],
    projects: [...workspaceState.projectsByWorkspaceId.values()].flat(),
    workspaces: workspaceState.workspaces,
    projectLinks: useIntegrationsStore.getState().links,
  })
  return {
    sessionId: session.id,
    projectId: facts.projectId,
    branch: facts.branch,
    workKey: facts.workItem?.ref.key ?? null,
    state,
    at,
  }
}

/** Reports each settled state change of any session, and `exited` at once for one that leaves. */
class StateChangeTracker {
  private readonly lastSeen = new Map<string, AgentState>()
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly send: (report: StateReport) => void) {}

  observeSessions(sessions: ReadonlyMap<string, TerminalSession>): void {
    for (const session of sessions.values()) this.watchSession(session)
    for (const sessionId of [...this.lastSeen.keys()].filter((id) => !sessions.has(id))) {
      this.lastSeen.delete(sessionId)
      this.cancel(sessionId)
      const gone = { projectId: null, branch: null, workKey: null }
      this.send({ ...gone, sessionId, state: 'exited', at: currentIsoTime() })
    }
  }

  stop(): void {
    this.pending.forEach((timer) => clearTimeout(timer))
  }

  private watchSession(session: TerminalSession): void {
    const state = agentStateOf(session)
    if (this.lastSeen.get(session.id) === state) return
    this.lastSeen.set(session.id, state)
    this.cancel(session.id)
    const at = currentIsoTime()
    const timer = setTimeout(() => {
      this.pending.delete(session.id)
      this.send(reportOf(session, state, at))
    }, SETTLE_MS)
    this.pending.set(session.id, timer)
  }

  private cancel(sessionId: string): void {
    clearTimeout(this.pending.get(sessionId))
    this.pending.delete(sessionId)
  }
}

/** Calls `send` once per settled state change of any session. Returns the way to stop. */
export function trackStateChanges(send: (report: StateReport) => void): () => void {
  const tracker = new StateChangeTracker(send)
  tracker.observeSessions(useSessionStore.getState().sessions)
  const unsubscribe = useSessionStore.subscribe((state) => tracker.observeSessions(state.sessions))
  return () => {
    unsubscribe()
    tracker.stop()
  }
}

/** Mirrors agent asks onto sessions, and reports session state changes to the attention log. */
export function useAgentAttention(): void {
  useEffect(() => {
    const api = window.electronAPI?.agentAsk
    const setAsk = useSessionStore.getState().setAgentAsk
    void api?.list?.().then(({ data }) => data.forEach((a) => setAsk(a.sessionId, a.ask)))
    return api?.onChanged?.(({ sessionId, ask }) => setAsk(sessionId, ask))
  }, [])

  useEffect(() => {
    const record = window.electronAPI?.attention?.record
    if (typeof record !== 'function') return undefined
    return trackStateChanges((report) => void record(report))
  }, [])
}
