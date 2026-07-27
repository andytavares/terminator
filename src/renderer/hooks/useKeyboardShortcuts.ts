import { useEffect } from 'react'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { useTerminalSession } from './useTerminalSession'
import { useSettingsStore } from '../stores/settings.store'
import { useExtensionRegistry, matchesAccelerator } from '../extensions/registry'
import { dispatchNotification } from '../lib/notifications'

interface Options {
  onOpenSettings?: () => void
  onToggleLog?: () => void
  onOpenCommandPalette?: () => void
  onToggleOverview?: () => void
  onNewScratch?: () => void
  onNewTab?: () => void
  /** Concept 10: the supervision surface is one keystroke away, not one click. */
  onToggleAttention?: () => void
  /** Escape leaves whichever full-screen view is open, like everywhere else. */
  onEscapeView?: () => void
  /** When scratch mode is active, pass SCRATCH_PROJECT_ID here so all terminal shortcuts work. */
  scratchProjectId?: string | null
}

export function useKeyboardShortcuts({
  onOpenSettings,
  onToggleLog,
  onOpenCommandPalette,
  onToggleOverview,
  onNewScratch,
  onNewTab,
  onToggleAttention,
  onEscapeView,
  scratchProjectId,
}: Options = {}): void {
  const {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspace,
    activeProjectId,
    resolveActiveCwd,
    setExpandedWorkspaceIds,
  } = useWorkspaceStore()
  const {
    getActiveSessionForProject,
    setActiveSessionForProject,
    getSessionsForProject,
    getPaneLayout,
    getFocusedSession,
    closeSplitLeaf,
    closeSession,
  } = useSessionStore()
  const { createSession, splitSession } = useTerminalSession()
  const { resolveSettings } = useSettingsStore()
  const { keyboardShortcuts } = useExtensionRegistry()

  const effectiveProjectId = scratchProjectId ?? activeProjectId

  useEffect(() => {
    function cycleWorkspace(delta: number): void {
      if (workspaces.length === 0) return
      const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId)
      const next = (idx + delta + workspaces.length) % workspaces.length
      setActiveWorkspace(workspaces[next].id)
      setExpandedWorkspaceIds(new Set([workspaces[next].id]))
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
      // With Shift held the browser reports the *shifted* character, so
      // Cmd+Shift+E arrives as 'E'. Every Cmd+Shift+<letter> shortcut compared
      // against a lowercase literal and therefore never fired; the tests
      // dispatched lowercase synthetically and never noticed.
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
      const inXterm = e.target instanceof HTMLElement && !!e.target.closest('.xterm')
      const inTextField =
        !inXterm &&
        (e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target instanceof HTMLElement && e.target.isContentEditable))

      if (isMeta && e.key === ',') {
        e.preventDefault()
        onOpenSettings?.()
        return
      }

      // Cmd+P: open command palette
      if (isMeta && key === 'p') {
        e.preventDefault()
        onOpenCommandPalette?.()
        return
      }

      // Cmd+Shift+L: toggle log window
      if (isMeta && e.shiftKey && key === 'l') {
        e.preventDefault()
        onToggleLog?.()
        return
      }

      // Cmd+Shift+E: toggle overview tab. Not Cmd+Shift+I — that is the "Open Extension
      // DevTools" menu accelerator, and Electron menu accelerators consume the key before
      // the renderer ever sees it, which made this branch unreachable.
      if (isMeta && e.shiftKey && key === 'e') {
        e.preventDefault()
        onToggleOverview?.()
        return
      }

      // Escape leaves a full-screen view. Never from a text field, where it
      // means "abandon what I am typing", and never from a terminal, where it
      // belongs to whatever is running in it — closing a view out from under
      // someone pressing Escape in vim would be indefensible.
      if (e.key === 'Escape' && !inTextField && !inXterm) {
        onEscapeView?.()
        return
      }

      // Cmd+Shift+A: the attention surface. The status bar answers "is
      // everything OK" at a glance; this is the one keystroke to the detail,
      // which is the whole of Concept 10 (FR-025).
      if (isMeta && e.shiftKey && key === 'a') {
        e.preventDefault()
        onToggleAttention?.()
        return
      }

      // Cmd+Shift+T: new scratch terminal
      if (isMeta && e.shiftKey && key === 't') {
        e.preventDefault()
        onNewScratch?.()
        return
      }

      // Extension-registered keyboard shortcuts — skip bare-key shortcuts when focus is in a text field
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

      // Cmd+1–9: switch to nth workspace, expand it, collapse all others
      if (isMeta && e.key >= '1' && e.key <= '9') {
        e.preventDefault()
        const idx = parseInt(e.key, 10) - 1
        if (workspaces[idx]) {
          setActiveWorkspace(workspaces[idx].id)
          setExpandedWorkspaceIds(new Set([workspaces[idx].id]))
        }
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

      // Cmd+K: clear terminal screen (skip if typing — Cmd+K kills to line start in text fields)
      if (isMeta && key === 'k' && !inTextField) {
        e.preventDefault()
        if (effectiveProjectId) {
          const activeSessionId = getActiveSessionForProject(effectiveProjectId)
          if (activeSessionId) {
            window.electronAPI.terminal.input(activeSessionId, '\x0c')
          }
        }
        return
      }

      // Cmd+T: new tab
      if (isMeta && key === 't') {
        e.preventDefault()
        if (onNewTab) {
          onNewTab()
        } else if (effectiveProjectId) {
          const settings = resolveSettings(activeWorkspaceId)
          const cwd = resolveActiveCwd()
          createSession(
            effectiveProjectId,
            'human',
            'Terminal',
            cwd,
            settings.terminal.scrollbackLimit
          )
        }
        return
      }

      // Cmd+D: split vertically (side by side) — always in the active project, never scratch
      if (isMeta && !e.shiftKey && key === 'd') {
        e.preventDefault()
        if (activeProjectId) {
          const settings = resolveSettings(activeWorkspaceId)
          const cwd = resolveActiveCwd()
          splitSession(activeProjectId, 'vertical', cwd, settings.terminal.scrollbackLimit).catch(
            () =>
              dispatchNotification({
                type: 'error',
                title: 'Split pane failed',
                message: 'Could not create split pane',
                key: 'splitPaneFailed',
              })
          )
        }
        return
      }

      // Cmd+Shift+D: split horizontally (top / bottom) — always in the active project, never scratch
      if (isMeta && e.shiftKey && key === 'd') {
        e.preventDefault()
        if (activeProjectId) {
          const settings = resolveSettings(activeWorkspaceId)
          const cwd = resolveActiveCwd()
          splitSession(activeProjectId, 'horizontal', cwd, settings.terminal.scrollbackLimit).catch(
            () =>
              dispatchNotification({
                type: 'error',
                title: 'Split pane failed',
                message: 'Could not create split pane',
                key: 'splitPaneFailed',
              })
          )
        }
        return
      }

      // Cmd+W: close focused split pane (or active tab if not in split mode)
      if (isMeta && key === 'w') {
        e.preventDefault()
        if (effectiveProjectId) {
          const layout = getPaneLayout(effectiveProjectId)
          const focusedId = getFocusedSession(effectiveProjectId)
          if (layout && focusedId) {
            closeSplitLeaf(effectiveProjectId, focusedId)
            closeSession(focusedId).catch(() =>
              dispatchNotification({
                type: 'error',
                title: 'Close terminal failed',
                message: 'Could not close terminal',
                key: 'closeTerminalFailed',
              })
            )
          } else {
            const activeId = getActiveSessionForProject(effectiveProjectId)
            if (activeId) closeSession(activeId)
          }
        }
        return
      }

      // Cmd+Left: previous tab (skip if typing — Cmd+Left/Right navigates within text)
      if (isMeta && e.key === 'ArrowLeft' && !inTextField) {
        e.preventDefault()
        if (effectiveProjectId) cycleTab(effectiveProjectId, -1)
        return
      }

      // Cmd+Right: next tab (skip if typing)
      if (isMeta && e.key === 'ArrowRight' && !inTextField) {
        e.preventDefault()
        if (effectiveProjectId) cycleTab(effectiveProjectId, 1)
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    workspaces,
    activeWorkspaceId,
    activeProjectId,
    scratchProjectId,
    effectiveProjectId,
    keyboardShortcuts,
    setActiveWorkspace,
    resolveSettings,
    resolveActiveCwd,
    createSession,
    splitSession,
    getSessionsForProject,
    getActiveSessionForProject,
    setActiveSessionForProject,
    getPaneLayout,
    getFocusedSession,
    closeSplitLeaf,
    closeSession,
    onOpenSettings,
    onToggleLog,
    onOpenCommandPalette,
    onToggleOverview,
    onNewScratch,
  ])
}
