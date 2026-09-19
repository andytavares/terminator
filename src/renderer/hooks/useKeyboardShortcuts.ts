import { useEffect } from 'react'
import { useWorkspaceStore } from '../stores/workspace.store'
import { useSessionStore } from '../stores/session.store'
import { useTerminalSession } from './useTerminalSession'
import { useSettingsStore } from '../stores/settings.store'
import { useExtensionRegistry, matchesAccelerator } from '../extensions/registry'
import {
  cycleMostRecentlyAttended,
  jumpToNextAwaitingInput,
  cycleWorkspace,
  cycleTab,
  clearTerminal,
  newTerminalTab,
  splitPane,
  closeFocusedPane,
} from '../quick-actions/shortcut-behaviors'

interface Options {
  onOpenSettings?: () => void
  onToggleLog?: () => void
  onOpenCommandPalette?: () => void
  onToggleOverview?: () => void
  onNewScratch?: () => void
  onNewTab?: () => void
  /** Opens the inline description editor for the focused session. */
  onEditSessionNote?: () => void
  /** A menu accelerator, not a renderer keydown on macOS: Cmd+` is claimed by
   * the OS for window cycling before the page ever sees it. Kept here so
   * `core-actions.ts` shares the same callback the "Home" quick action runs. */
  onOpenHome?: () => void
  /** When scratch mode is active, pass SCRATCH_PROJECT_ID here so all terminal shortcuts work. */
  scratchProjectId?: string | null
  /** Called with the CORE_SHORTCUTS action id whenever this hook handles a direct shortcut. */
  onDirectShortcut?: (actionId: string) => void
}

export function useKeyboardShortcuts({
  onOpenSettings,
  onToggleLog,
  onOpenCommandPalette,
  onToggleOverview,
  onNewScratch,
  onNewTab,
  onEditSessionNote,
  scratchProjectId,
  onDirectShortcut,
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
    const workspaceCycleDeps = {
      workspaces,
      activeWorkspaceId,
      setActiveWorkspace,
      setExpandedWorkspaceIds,
    }
    const tabCycleDeps = {
      getSessionsForProject,
      getActiveSessionForProject,
      setActiveSessionForProject,
    }
    const newTabDeps = { resolveSettings, resolveActiveCwd, activeWorkspaceId, createSession }
    const splitDeps = { resolveSettings, resolveActiveCwd, activeWorkspaceId, splitSession }
    const closePaneDeps = {
      getPaneLayout,
      getFocusedSession,
      closeSplitLeaf,
      closeSession,
      getActiveSessionForProject,
    }

    function handleKeyDown(e: KeyboardEvent): void {
      const isMeta = e.metaKey || e.ctrlKey
      const inXterm = e.target instanceof HTMLElement && !!e.target.closest('.xterm')
      const inTextField =
        !inXterm &&
        (e.target instanceof HTMLInputElement ||
          e.target instanceof HTMLTextAreaElement ||
          (e.target instanceof HTMLElement && e.target.isContentEditable))

      if (isMeta && e.key === ',') {
        e.preventDefault()
        onDirectShortcut?.('core.open-settings')
        onOpenSettings?.()
        return
      }

      // Cmd+P: open command palette
      if (isMeta && e.key === 'p') {
        e.preventDefault()
        onOpenCommandPalette?.()
        return
      }

      // Cmd+Shift+L: toggle log window
      if (isMeta && e.shiftKey && e.key === 'l') {
        e.preventDefault()
        onDirectShortcut?.('core.toggle-log')
        onToggleLog?.()
        return
      }

      // Cmd+Shift+E: toggle overview tab. Not Cmd+Shift+I — that is the "Open Extension
      // DevTools" menu accelerator, and Electron menu accelerators consume the key before
      // the renderer ever sees it, which made this branch unreachable.
      if (isMeta && e.shiftKey && e.key === 'e') {
        e.preventDefault()
        onDirectShortcut?.('core.toggle-overview')
        onToggleOverview?.()
        return
      }

      // Cmd+Shift+T: new scratch terminal
      if (isMeta && e.shiftKey && e.key === 't') {
        e.preventDefault()
        onDirectShortcut?.('core.new-scratch')
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
          onDirectShortcut?.('core.switch-workspace')
          setActiveWorkspace(workspaces[idx].id)
          setExpandedWorkspaceIds(new Set([workspaces[idx].id]))
        }
        return
      }

      // Cmd+= or Cmd++: next workspace
      if (isMeta && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        onDirectShortcut?.('core.cycle-workspace-next')
        cycleWorkspace(1, workspaceCycleDeps)
        return
      }

      // Cmd+-: previous workspace
      if (isMeta && e.key === '-') {
        e.preventDefault()
        onDirectShortcut?.('core.cycle-workspace-prev')
        cycleWorkspace(-1, workspaceCycleDeps)
        return
      }

      // Cmd+K: clear terminal screen (skip if typing — Cmd+K kills to line start in text fields)
      if (isMeta && e.key === 'k' && !inTextField) {
        e.preventDefault()
        onDirectShortcut?.('core.clear')
        clearTerminal(effectiveProjectId, { getActiveSessionForProject })
        return
      }

      // Cmd+T: new tab
      if (isMeta && e.key === 't') {
        e.preventDefault()
        onDirectShortcut?.('core.new-tab')
        if (onNewTab) {
          onNewTab()
        } else {
          newTerminalTab(effectiveProjectId, newTabDeps)
        }
        return
      }

      // Cmd+D: split vertically (side by side). `effectiveProjectId` rather
      // than `activeProjectId`, so a scratch terminal splits too — it used to
      // do nothing at all there, and say nothing, which reads as the feature
      // having been removed rather than as not applying.
      if (isMeta && !e.shiftKey && e.key === 'd') {
        e.preventDefault()
        onDirectShortcut?.('core.split-vertical')
        splitPane(effectiveProjectId, 'vertical', splitDeps)
        return
      }

      // Cmd+Shift+D: split horizontally (top / bottom).
      if (isMeta && e.shiftKey && e.key === 'd') {
        e.preventDefault()
        onDirectShortcut?.('core.split-horizontal')
        splitPane(effectiveProjectId, 'horizontal', splitDeps)
        return
      }

      // Cmd+W: close focused split pane (or active tab if not in split mode)
      if (isMeta && e.key === 'w') {
        e.preventDefault()
        onDirectShortcut?.('core.close-tab')
        closeFocusedPane(effectiveProjectId, closePaneDeps)
        return
      }

      // Cmd+] / Cmd+[: cycle recently attended sessions across project
      // boundaries. lastAttendedAt is what makes "recently used" meaningful;
      // this is its only consumer.
      if (isMeta && (e.key === ']' || e.key === '[') && !inTextField) {
        e.preventDefault()
        onDirectShortcut?.(e.key === ']' ? 'core.cycle-recent-next' : 'core.cycle-recent-prev')
        cycleMostRecentlyAttended(effectiveProjectId, e.key === ']' ? 1 : -1, {
          getActiveSessionForProject,
          setActiveSessionForProject,
        })
        return
      }

      // Cmd+Shift+A: jump to the next session waiting on you.
      if (isMeta && e.shiftKey && (e.key === 'a' || e.key === 'A') && !inTextField) {
        e.preventDefault()
        onDirectShortcut?.('core.next-waiting')
        jumpToNextAwaitingInput(effectiveProjectId, {
          getActiveSessionForProject,
          setActiveSessionForProject,
        })
        return
      }

      // Cmd+I: edit the focused session's description.
      if (isMeta && !e.shiftKey && (e.key === 'i' || e.key === 'I') && !inTextField) {
        e.preventDefault()
        onDirectShortcut?.('core.edit-note')
        onEditSessionNote?.()
        return
      }

      // Cmd+Left: previous tab (skip if typing — Cmd+Left/Right navigates within text)
      if (isMeta && e.key === 'ArrowLeft' && !inTextField) {
        e.preventDefault()
        onDirectShortcut?.('core.prev-tab')
        if (effectiveProjectId) cycleTab(effectiveProjectId, -1, tabCycleDeps)
        return
      }

      // Cmd+Right: next tab (skip if typing)
      if (isMeta && e.key === 'ArrowRight' && !inTextField) {
        e.preventDefault()
        onDirectShortcut?.('core.next-tab')
        if (effectiveProjectId) cycleTab(effectiveProjectId, 1, tabCycleDeps)
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
    onEditSessionNote,
    setActiveSessionForProject,
    getActiveSessionForProject,
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
    onDirectShortcut,
  ])
}
