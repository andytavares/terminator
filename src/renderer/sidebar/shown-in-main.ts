import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import type { BranchTerminal } from './branch-rows'

/** What decides the main area's content (`src/renderer/shell/MainArea.tsx`). */
export interface MainAreaFacts {
  /** An app-level or repo-level tab (Home, Overview, an extension's) covers the main area. */
  surfaceTabOpen: boolean
  /** An extension tab shows in place of the branch's terminal. */
  projectTabOpen: boolean
  scratchActive: boolean
  activeProjectId: string | null
  /** The terminal a branch shows when it is open: its last one, kept per branch. */
  activeSessionOf: (projectId: string) => string | null
}

/** The branch on screen and its terminal, or null when no branch is on screen. */
export interface ShownInMain {
  projectId: string
  sessionId: string | null
}

/** The one session the sidebar may mark: what the main area draws, in MainArea's order. */
export function shownInMain(facts: MainAreaFacts): ShownInMain | null {
  if (facts.surfaceTabOpen) return null
  if (facts.scratchActive) {
    return { projectId: SCRATCH_PROJECT_ID, sessionId: facts.activeSessionOf(SCRATCH_PROJECT_ID) }
  }
  const projectId = facts.activeProjectId
  if (projectId === null) return null
  const sessionId = facts.projectTabOpen ? null : facts.activeSessionOf(projectId)
  return { projectId, sessionId }
}

/** A branch row stands for the shown session when that session has no row of its own listed.
 * `listedSessionIds` is empty while the branch's terminals are folded away. */
export function branchStandsForShown(
  shown: ShownInMain | null,
  projectId: string,
  listedSessionIds: readonly string[]
): boolean {
  if (shown?.projectId !== projectId) return false
  return shown.sessionId === null || !listedSessionIds.includes(shown.sessionId)
}

/** A folded repo header stands for the shown session when the shown branch is inside it. */
export function repoStandsForShown(
  shown: ShownInMain | null,
  collapsed: boolean,
  branchProjectIds: readonly string[]
): boolean {
  return collapsed && shown !== null && branchProjectIds.includes(shown.projectId)
}

/** Every terminal and pane a branch lists under it once expanded. */
export function listedSessionIds(terminals: readonly BranchTerminal[]): string[] {
  return terminals.flatMap((terminal) => [
    terminal.sessionId,
    ...terminal.panes.map((pane) => pane.sessionId),
  ])
}
