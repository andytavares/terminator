import { STATUS_ORDER } from './view-model'
import { branchLabel } from './branch-display'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import type { AgentState, Project, TerminalSession, Workspace } from '../../shared/types/index'

/** One terminal, as the board draws it. */
export interface BoardCard {
  sessionId: string
  title: string
  /** "<repo> / <branch>", or "no branch" for a scratch terminal. */
  sourceLabel: string
  state: AgentState
  bellCount: number
  lastActivityAt: number
  /** null for a terminal with no repo, which draws no rail. */
  workspaceColor: string | null
}

export interface BoardLane {
  state: AgentState
  label: string
  cards: BoardCard[]
  count: number
  /** False when the user has hidden it, or when it is history and empty. */
  visible: boolean
  /**
   * The user's own choice, separate from `visible`.
   *
   * An empty history lane is invisible whether or not it was hidden, so
   * `visible` cannot answer "is there something to restore here" — unhiding an
   * empty Exited lane left it invisible and the restore control stuck.
   */
  hiddenByUser: boolean
  /** True for `exited` alone — a record rather than a queue. */
  isHistory: boolean
}

const LANE_LABEL: Record<AgentState, string> = {
  'awaiting-input': 'Needs you',
  working: 'Working',
  idle: 'Idle',
  exited: 'Exited',
}

/** The one lane that reads as history, and so hides itself when empty. */
const HISTORY_STATE: AgentState = 'exited'

const SCRATCH_SOURCE = 'no branch'

/**
 * Every open terminal, in a lane per state.
 *
 * A closed terminal is filed under `exited` whatever its stored state says:
 * the process is gone, and that outranks whatever it was doing when it went.
 *
 * `visible` is presentational only — a hidden lane keeps its cards, so showing
 * it again costs nothing and needs no recomputation. The exited lane hides
 * itself while empty because an empty record is not worth a column; an empty
 * *live* lane stays, because "nothing is waiting on you" is worth reading.
 */
export function buildLanes(
  sessions: TerminalSession[],
  projects: Project[],
  workspaces: Workspace[],
  hiddenLanes: AgentState[]
): BoardLane[] {
  const projectById = new Map(projects.map((p) => [p.id, p]))
  const workspaceById = new Map(workspaces.map((w) => [w.id, w]))

  const cardsByState = new Map<AgentState, BoardCard[]>(STATUS_ORDER.map((s) => [s, []]))

  for (const session of sessions) {
    const state: AgentState = session.status === 'closed' ? HISTORY_STATE : session.agentState
    const bucket = cardsByState.get(state)
    if (bucket === undefined) continue

    const isScratch = session.projectId === SCRATCH_PROJECT_ID
    const project = isScratch ? undefined : projectById.get(session.projectId)
    // A terminal whose branch has gone is dropped rather than crashing the
    // board — the same tolerance buildGroups already applies to the sidebar.
    if (!isScratch && project === undefined) continue
    const workspace = project ? workspaceById.get(project.workspaceId) : undefined

    bucket.push({
      sessionId: session.id,
      title: session.tabTitle,
      sourceLabel:
        project && workspace ? `${workspace.name} / ${branchLabel(project)}` : SCRATCH_SOURCE,
      state,
      bellCount: session.bellCount ?? 0,
      lastActivityAt: session.lastActivityAt,
      workspaceColor: workspace?.color ?? null,
    })
  }

  const hidden = new Set(hiddenLanes)

  return STATUS_ORDER.map((state): BoardLane => {
    const cards = [...(cardsByState.get(state) ?? [])].sort(
      (a, b) => b.lastActivityAt - a.lastActivityAt
    )
    const isHistory = state === HISTORY_STATE
    return {
      state,
      label: LANE_LABEL[state],
      cards,
      count: cards.length,
      visible: !hidden.has(state) && !(isHistory && cards.length === 0),
      hiddenByUser: hidden.has(state),
      isHistory,
    }
  })
}

/** One key, matching the existing sidebar keys (width, expanded, collapsed, views). */
export const LANES_STORAGE_KEY = 'terminator.board.lanes'

const KNOWN_STATES = new Set<string>(STATUS_ORDER)

/**
 * Which lanes the user has hidden.
 *
 * Corrupt or unreadable storage degrades to "everything visible" rather than
 * throwing — the same convention as loadViews and workspace.store's
 * loadExpandedIds. A board that will not render is worse than a board showing
 * one lane too many. Unknown states are dropped rather than failing the whole
 * read, so a preference written by a later version does not blank the board.
 */
export function loadHiddenLanes(): AgentState[] {
  try {
    const raw = localStorage.getItem(LANES_STORAGE_KEY)
    if (raw === null) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is AgentState => typeof s === 'string' && KNOWN_STATES.has(s))
  } catch {
    return []
  }
}

/** Persisting a preference must never take the board down with it. */
export function saveHiddenLanes(hidden: AgentState[]): void {
  try {
    localStorage.setItem(LANES_STORAGE_KEY, JSON.stringify(hidden))
  } catch {
    /* a preference is not worth an exception */
  }
}
