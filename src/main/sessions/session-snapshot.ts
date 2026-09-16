import type { SessionInfo } from '../terminal/pty-manager.js'
import { getProjectById, listWorkspaces } from '../storage/workspace-store.js'
import type { SessionSnapshot } from '../../shared/types/index.js'
import { listRecords } from './session-record-store.js'

/** The part of the PTY registry this needs: where a live terminal is. */
interface SessionLookup {
  getSession(sessionId: string): SessionInfo | undefined
}

/** The snapshot kept on a session's record, if this process has one. */
function recordedSnapshot(sessionId: string): SessionSnapshot | null {
  const record = listRecords().find((r) => r.sessionId === sessionId)
  if (record === undefined) return null
  const { description: _d, link: _l, agent: _a, updatedAt: _u, closedAt: _c, ...snapshot } = record
  return snapshot
}

/**
 * Where a terminal lives, as this process can see it.
 *
 * The renderer supplies a snapshot when the operator writes about a session,
 * because it is the renderer that knows what is on screen. Nothing on screen is
 * involved when an agent reports a conversation, so the facts come from the
 * terminal registry and the workspace store instead.
 */
export function makeSnapshotFor(sessions: SessionLookup) {
  return (sessionId: string): SessionSnapshot | null => {
    const info = sessions.getSession(sessionId)
    // The terminal has gone, which is the case this whole feature exists for: an
    // agent's own exit ends it, and its last report can land afterwards. What
    // was already recorded about the session still says where it lived.
    if (info === undefined) return recordedSnapshot(sessionId)

    const project = info.projectId === undefined ? undefined : getProjectById(info.projectId)
    const workspace =
      project === undefined ? undefined : listWorkspaces().find((w) => w.id === project.workspaceId)

    return {
      sessionId,
      projectId: info.projectId ?? '',
      workspaceName: workspace?.name ?? null,
      projectName: project?.name ?? null,
      branch: project?.gitBranch ?? null,
      tabTitle: info.tabTitle ?? '',
      // The registry does not keep it, and a snapshot states what is known.
      shell: null,
      startedAt: info.createdAt,
    }
  }
}
