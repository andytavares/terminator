import { useExtensionRegistry } from '../extensions/registry'
import { useNavigationStore, type NavigationEntry } from './navigation.store'
import { useSessionStore } from './session.store'
import { useWorkspaceStore } from './workspace.store'

/** True while back or forward writes the stores, so the writes are not recorded as new entries. */
let restoring = false

function currentEntry(): NavigationEntry {
  const registry = useExtensionRegistry.getState()
  const projectId = useWorkspaceStore.getState().activeProjectId
  return {
    globalTabId: registry.activeGlobalTabId,
    workspaceTabId: registry.activeWorkspaceTabId,
    projectTabId: registry.activeProjectTabId,
    projectId,
    sessionId: projectId ? useSessionStore.getState().getActiveSessionForProject(projectId) : null,
  }
}

function recordCurrent(): void {
  if (!restoring) useNavigationStore.getState().record(currentEntry())
}

/** Records every change of what the main area shows. Returns the function that stops it. */
export function trackNavigation(): () => void {
  recordCurrent()
  const stops = [useExtensionRegistry, useWorkspaceStore, useSessionStore].map((store) =>
    store.subscribe(recordCurrent)
  )
  return () => stops.forEach((stop) => stop())
}

function restore(entry: NavigationEntry): void {
  restoring = true
  try {
    useExtensionRegistry.setState({
      activeGlobalTabId: entry.globalTabId,
      activeWorkspaceTabId: entry.workspaceTabId,
      activeProjectTabId: entry.projectTabId,
    })
    useWorkspaceStore.getState().setActiveProject(entry.projectId)
    const sessions = useSessionStore.getState()
    if (entry.projectId && entry.sessionId && sessions.sessions.has(entry.sessionId)) {
      sessions.setActiveSessionForProject(entry.projectId, entry.sessionId)
    }
  } finally {
    restoring = false
  }
}

function move(delta: -1 | 1): void {
  const entry = useNavigationStore.getState().step(delta)
  if (entry) restore(entry)
}

export const goBack = (): void => move(-1)
export const goForward = (): void => move(1)
