import React, { useEffect, useMemo } from 'react'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useMetricsStore } from '../../stores/metrics.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { SessionTile } from './SessionTile'
import type { Project, Workspace, TerminalSession } from '../../../../shared/types/index'
import { SCRATCH_PROJECT_ID } from '../../../shared/types/index'
import './OverviewScreen.css'

interface TileData {
  session: TerminalSession
  project: Project
  workspace: Workspace
  isScratch?: boolean
}

const SCRATCH_WORKSPACE: Workspace = {
  id: SCRATCH_PROJECT_ID,
  name: 'Scratch',
  folderPath: '',
  color: '#858585',
  tags: [],
  createdAt: '',
  updatedAt: '',
}

const SCRATCH_PROJECT: Project = {
  id: SCRATCH_PROJECT_ID,
  workspaceId: SCRATCH_PROJECT_ID,
  name: '',
  isWorktree: false,
  createdAt: '',
  updatedAt: '',
}

export function OverviewScreen(): JSX.Element {
  const { sessions } = useSessionStore()
  const { workspaces, projectsByWorkspaceId, setScratchActive } = useWorkspaceStore()
  const { processesBySessionId, startPolling, stopPolling } = useMetricsStore()
  const { busySessions } = useSessionStore()

  // Build fast lookup maps
  const projectById = useMemo(() => {
    const m = new Map<string, Project>()
    for (const projects of projectsByWorkspaceId.values()) {
      for (const p of projects) m.set(p.id, p)
    }
    return m
  }, [projectsByWorkspaceId])

  const workspaceById = useMemo(() => {
    const m = new Map<string, Workspace>()
    for (const w of workspaces) m.set(w.id, w)
    return m
  }, [workspaces])

  // Build ordered tile list — busy first, then workspace → project → tab title
  const tiles = useMemo((): TileData[] => {
    const result: TileData[] = []
    for (const session of sessions.values()) {
      if (session.status === 'closed') continue
      if (session.projectId === SCRATCH_PROJECT_ID) {
        result.push({
          session,
          project: SCRATCH_PROJECT,
          workspace: SCRATCH_WORKSPACE,
          isScratch: true,
        })
        continue
      }
      const project = projectById.get(session.projectId)
      if (!project) continue
      const workspace = workspaceById.get(project.workspaceId)
      if (!workspace) continue
      result.push({ session, project, workspace })
    }
    result.sort((a, b) => {
      const aBusy = busySessions.has(a.session.id) ? 0 : 1
      const bBusy = busySessions.has(b.session.id) ? 0 : 1
      if (aBusy !== bBusy) return aBusy - bBusy
      const wCmp = a.workspace.name.localeCompare(b.workspace.name)
      if (wCmp !== 0) return wCmp
      const pCmp = a.project.name.localeCompare(b.project.name)
      if (pCmp !== 0) return pCmp
      return a.session.tabTitle.localeCompare(b.session.tabTitle)
    })
    return result
  }, [sessions, projectById, workspaceById, busySessions])

  // Resolve PIDs and start polling whenever the session list changes
  const sessionIdsKey = tiles.map((t) => t.session.id).join(',')
  useEffect(() => {
    if (tiles.length === 0) {
      startPolling([])
      return stopPolling
    }
    let cancelled = false
    const sessionIds = tiles.map((t) => t.session.id)
    window.electronAPI.metrics
      .getPids(sessionIds)
      .then((result) => {
        if (cancelled) return
        const resolved = 'data' in result ? result.data : []
        startPolling(resolved)
      })
      .catch(() => {
        if (!cancelled) startPolling([])
      })
    return () => {
      cancelled = true
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdsKey])

  function navigate(tile: TileData): void {
    useExtensionRegistry.getState().setActiveGlobalTab(null)
    if (tile.isScratch) {
      setScratchActive(true)
      return
    }
    const { activeWorkspaceId, setActiveWorkspace, setActiveProject } = useWorkspaceStore.getState()
    if (tile.project.workspaceId !== activeWorkspaceId) {
      setActiveWorkspace(tile.project.workspaceId)
    }
    setActiveProject(tile.project.id)
  }

  return (
    <div className="overview-screen">
      {tiles.length === 0 ? (
        <div className="overview-screen__empty">No open terminals</div>
      ) : (
        <div className="overview-screen__grid">
          {tiles.map((tile, index) => (
            <SessionTile
              key={tile.session.id}
              session={tile.session}
              project={tile.project}
              workspace={tile.workspace}
              processMetrics={processesBySessionId.get(tile.session.id) ?? null}
              tileIndex={index}
              onNavigate={() => navigate(tile)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
