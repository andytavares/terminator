import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { SCRATCH_PROJECT_ID } from '../../shared/types/index'
import type { Project, TerminalSession, Workspace } from '../../shared/types/index'

export interface ActiveScope {
  activeWorkspace: Workspace | undefined
  activeProject: Project | undefined
  /** A worktree's own path, else the workspace folder. */
  repoRoot: string | null
}

/** The workspace and branch on screen. */
export function useActiveScope(): ActiveScope {
  const { activeWorkspaceId, activeProjectId, workspaces, projectsByWorkspaceId } =
    useWorkspaceStore(
      useShallow((s) => ({
        activeWorkspaceId: s.activeWorkspaceId,
        activeProjectId: s.activeProjectId,
        workspaces: s.workspaces,
        projectsByWorkspaceId: s.projectsByWorkspaceId,
      }))
    )
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
  const activeProjects = activeWorkspaceId
    ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? [])
    : []
  const activeProject = activeProjects.find((p) => p.id === activeProjectId)
  const repoRoot = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? null
  return { activeWorkspace, activeProject, repoRoot }
}

export interface QuickActionTarget {
  /** The scratch project while scratch is showing, else the active branch. */
  projectId: string | null
  focusedSessionId: string | null
  focusedSession: TerminalSession | undefined
}

/** The terminal Quick Actions act on. */
export function useQuickActionTarget(): QuickActionTarget {
  const { scratchActive, activeProjectId } = useWorkspaceStore(
    useShallow((s) => ({ scratchActive: s.scratchActive, activeProjectId: s.activeProjectId }))
  )
  const { sessions, getFocusedSession, getActiveSessionForProject } = useSessionStore(
    useShallow((s) => ({
      sessions: s.sessions,
      getFocusedSession: s.getFocusedSession,
      getActiveSessionForProject: s.getActiveSessionForProject,
      projectViews: s.projectViews,
    }))
  )
  const projectId = scratchActive ? SCRATCH_PROJECT_ID : activeProjectId
  const focusedSessionId = projectId
    ? (getFocusedSession?.(projectId) ?? getActiveSessionForProject?.(projectId) ?? null)
    : null
  const focusedSession = focusedSessionId ? sessions.get(focusedSessionId) : undefined
  return { projectId, focusedSessionId, focusedSession }
}
