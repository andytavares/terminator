import type { TerminalSession } from '../../../shared/types/index'
import { sessionIssueKeys, type BranchRow as BranchRowData } from '../../sidebar/branch-rows'
import type { WorkItem } from '../../sidebar/work-item'
import { useSessionStore } from '../../stores/session.store'
import { BranchRow } from './BranchRow'

type WorkItems = Map<string, WorkItem | null>

interface ScratchSectionProps {
  scratch: TerminalSession[]
  sessions: Map<string, TerminalSession>
  workItems: WorkItems
  now: number
  onNewScratch: () => void
  activeScratchSessionId: string | null
  onSelectScratchSession: (sessionId: string) => void
}

/**
 * Scratch terminals belong to no branch, so they are the one place a terminal
 * is still a row. Drawn as branch rows because in this section a scratch
 * terminal IS the unit of work — same anatomy, same vocabulary, and no colour
 * rail because it has no repo.
 */
export function ScratchSection(props: ScratchSectionProps): JSX.Element {
  const { scratch, sessions, workItems, now } = props
  return (
    <div className="unified-sidebar__scratch">
      <ScratchHead count={scratch.length} onNewScratch={props.onNewScratch} />
      {scratch.map((session) => (
        <BranchRow
          key={session.id}
          row={scratchRow(session, sessions, workItems)}
          selected={props.activeScratchSessionId === session.id}
          now={now}
          onSelect={() => props.onSelectScratchSession(session.id)}
          onRename={(title) => useSessionStore.getState().renameSession(session.id, title)}
          sessionIssueKeys={scratchIssueKeys(session.id, sessions, workItems)}
        />
      ))}
    </div>
  )
}

function ScratchHead({ count, onNewScratch }: { count: number; onNewScratch: () => void }) {
  return (
    <div className="unified-sidebar__scratch-head">
      <span className="unified-sidebar__scratch-label">Scratch</span>
      <button
        className="unified-sidebar__scratch-add"
        title="New scratch terminal"
        aria-label="New scratch terminal"
        onClick={onNewScratch}
      >
        +
      </button>
      {/* Last on the row, in the same column as every other count. */}
      <span className="unified-sidebar__scratch-count">{count}</span>
    </div>
  )
}

/** The panes split off a scratch terminal. */
function panesOf(sessionId: string, sessions: Map<string, TerminalSession>): TerminalSession[] {
  return [...sessions.values()].filter((s) => s.parentSessionId === sessionId)
}

/** A scratch terminal drawn as a branch row. */
function scratchRow(
  session: TerminalSession,
  sessions: Map<string, TerminalSession>,
  workItems: WorkItems
): BranchRowData {
  return {
    projectId: session.id,
    label: session.tabTitle,
    // No kind marker: a scratch folder is neither a worktree nor a checkout,
    // and the glyph would be answering a question nobody asked of it.
    isWorktree: true,
    state: session.agentState,
    stateCount: 1,
    sessionCount: 1,
    // A scratch row *is* its terminal, so what nests under it is the panes
    // split off it — the same one level the session controller pins.
    terminals: panesOf(session.id, sessions).map((pane) => ({
      sessionId: pane.id,
      title: pane.tabTitle,
      state: pane.agentState,
      bellCount: pane.bellCount ?? 0,
      panes: [],
      workItem: workItems.get(pane.id) ?? null,
    })),
    lastActivityAt: session.lastActivityAt,
    workspaceId: '',
  }
}

/** A scratch row is its terminal: its own key, then any its split panes carry. */
function scratchIssueKeys(
  sessionId: string,
  sessions: Map<string, TerminalSession>,
  workItems: WorkItems
): string[] {
  const ids = [sessionId, ...panesOf(sessionId, sessions).map((s) => s.id)]
  return sessionIssueKeys(
    ids.map((id) => ({
      sessionId: id,
      title: '',
      state: 'idle',
      bellCount: 0,
      panes: [],
      workItem: workItems.get(id) ?? null,
    }))
  )
}
