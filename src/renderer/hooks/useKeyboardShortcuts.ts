import { useEffect } from 'react'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { useTerminalSession } from './useTerminalSession'
import { useSettingsStore } from '../stores/settings.store'
import { useExtensionRegistry, matchesAccelerator } from '../extensions/registry'

interface Options {
  onOpenSettings?: () => void
  onToggleLog?: () => void
}

export function useKeyboardShortcuts({ onOpenSettings, onToggleLog }: Options = {}): void {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    activeProjectId,
    projectsByWorkspaceId,
  } = useWorkspaceStore()
  const { getActiveSessionForProject, setActiveSessionForProject, getSessionsForProject } =
    useSessionStore()
  const { createSession } = useTerminalSession()
  const { resolveSettings } = useSettingsStore()
  const { keyboardShortcuts } = useExtensionRegistry()

  useEffect(() => {
    function cycleWorkspace(delta: number): void {
      if (workspaces.length === 0) return
      const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId)
      const next = (idx + delta + workspaces.length) % workspaces.length
      setActiveWorkspace(workspaces[next].id)
    }

    function cycleTab(projectId: string, delta: number): void {
      const sessions = getSessionsForProject(projectId)
      if (sessions.length === 0) return
      const activeId = getActiveSessionForProject(projectId)
      const idx = sessions.findIndex((s) => s.id === activeId)
      const next = (idx + delta + sessions.length) % sessions.length
      setActiveSessionForProject(projectId, sessions[next].id)
    }

    function handleKeyDown(e: KeyboardEvent): void {
      const isMeta = e.metaKey || e.ctrlKey

      if (isMeta && e.key === ',') {
        e.preventDefault()
        onOpenSettings?.()
        return
      }

      // Cmd+Shift+L: toggle log window
      if (isMeta && e.shiftKey && e.key === 'l') {
        e.preventDefault()
        onToggleLog?.()
        return
      }

      // Extension-registered keyboard shortcuts — skip bare-key shortcuts when focus is in a text field
      const inTextField =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      for (const shortcut of keyboardShortcuts) {
        if (matchesAccelerator(e, shortcut.accelerator)) {
          // Bare-key shortcuts (no Cmd/Ctrl/Alt/Shift) must not fire while typing
          const hasModifier =
            shortcut.accelerator.includes('CmdOrCtrl') ||
            shortcut.accelerator.includes('Cmd') ||
            shortcut.accelerator.includes('Ctrl') ||
            shortcut.accelerator.includes('Alt') ||
            shortcut.accelerator.includes('Option') ||
            shortcut.accelerator.includes('Shift')
          if (inTextField && !hasModifier) continue
          e.preventDefault()
          shortcut.action()
          return
        }
      }

      // Cmd+1–9: switch to nth workspace
      if (isMeta && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = parseInt(e.key, 10) - 1
        if (workspaces[idx]) setActiveWorkspace(workspaces[idx].id)
        return
      }

      // Cmd+= or Cmd++: next workspace
      if (isMeta && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        cycleWorkspace(1)
        return
      }

      // Cmd+-: previous workspace
      if (isMeta && e.key === '-') {
        e.preventDefault()
        cycleWorkspace(-1)
        return
      }

      // Cmd+T: new tab
      if (isMeta && e.key === 't') {
        e.preventDefault()
        if (activeProjectId) {
          const settings = resolveSettings(activeWorkspaceId)
          const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId)
          const projects = activeWorkspaceId
            ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? [])
            : []
          const activeProject = projects.find((p) => p.id === activeProjectId)
          const cwd = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? '~'
          createSession(
            activeProjectId,
            'human',
            'Terminal',
            cwd,
            settings.terminal.scrollbackLimit
          )
        }
        return
      }

      // Cmd+Left: previous tab
      if (isMeta && e.key === 'ArrowLeft') {
        e.preventDefault()
        if (activeProjectId) cycleTab(activeProjectId, -1)
        return
      }

      // Cmd+Right: next tab
      if (isMeta && e.key === 'ArrowRight') {
        e.preventDefault()
        if (activeProjectId) cycleTab(activeProjectId, 1)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    workspaces,
    activeWorkspaceId,
    activeProjectId,
    keyboardShortcuts,
    setActiveWorkspace,
    resolveSettings,
    projectsByWorkspaceId,
    createSession,
    getSessionsForProject,
    getActiveSessionForProject,
    setActiveSessionForProject,
    onOpenSettings,
    onToggleLog,
  ])
}
