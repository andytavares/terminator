import type { SessionInfo } from '@terminator/extension-sdk'
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

type ProjectPlace = Pick<SessionSnapshot, 'workspaceName' | 'projectName' | 'branch'>

/** The workspace, project and branch a project id names, as far as the store knows them. */
export function projectPlace(projectId: string | undefined): ProjectPlace {
  const project = projectId === undefined ? undefined : getProjectById(projectId)
  const workspace =
    project === undefined ? undefined : listWorkspaces().find((w) => w.id === project.workspaceId)
  return {
    workspaceName: workspace?.name ?? null,
    projectName: project?.name ?? null,
    branch: project?.gitBranch ?? null,
  }
}

/** The snapshot of a terminal that is still running, from the registry and the workspace store. */
function liveSnapshot(sessionId: string, info: SessionInfo): SessionSnapshot {
  return {
    sessionId,
    projectId: info.projectId ?? '',
    ...projectPlace(info.projectId),
    tabTitle: info.tabTitle ?? '',
    // The registry does not keep it, and a snapshot states what is known.
    shell: null,
    startedAt: info.createdAt,
  }
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
    return info === undefined ? recordedSnapshot(sessionId) : liveSnapshot(sessionId, info)
  }
}
