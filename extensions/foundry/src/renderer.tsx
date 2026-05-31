// Foundry renderer entry — discovered automatically via Vite glob import.
import React from 'react'
import { Bot } from 'lucide-react'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { FoundryPanel } from './components/FoundryPanel'
import { RunConsole } from './components/RunConsole'
import { HistoryView } from './components/HistoryView'

const registry = useExtensionRegistry.getState()

// ── Foundry global tab ─────────────────────────────────────────────────────────
// Global tab wrapper: reads repoRoot from the workspace store so it works
// without receiving props (GlobalTabRegistration components take no props).
function FoundryGlobalTab() {
  const { workspaces, activeWorkspaceId } = useWorkspaceStore()

  // Foundry is always scoped to the workspace root, never to an individual
  // project or worktree path. Using the workspace folderPath directly avoids
  // the bug where setActiveProject(worktreeId) would change repoRoot to the
  // worktree directory after a run starts.
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  const repoRoot = activeWorkspace?.folderPath ?? null

  return React.createElement(FoundryPanel, {
    repoRoot,
    onClose: () => registry.setActiveGlobalTab(null),
  })
}

registry.registerGlobalTab({
  id: 'foundry',
  label: 'Foundry',
  icon: React.createElement(Bot, { size: 16 }),
  component: FoundryGlobalTab,
  hidden: true,
})

// ── Sidebar button in the ProjectsPanel ────────────────────────────────────────
// Registers a "Foundry" button at the bottom of the project sidebar — the
// primary visible entry point for opening Foundry from the workspace.
registry.registerSidebarButton({
  id: 'foundry',
  label: 'Foundry',
  icon: React.createElement(Bot, { size: 14 }),
  action() {
    const current = useExtensionRegistry.getState().activeGlobalTabId
    registry.setActiveGlobalTab(current === 'foundry' ? null : 'foundry')
  },
})

// ── Run console auxiliary window view ──────────────────────────────────────────
registry.registerWindowView('foundry-run', RunConsole)

// ── Always-on worktree project listeners ───────────────────────────────────────
// These must be registered at module load time (not inside a React component)
// so they remain active regardless of which tab is currently open.

function invoke(channel: string, payload: unknown) {
  return window.electronAPI.extensionBridge.invoke(channel, payload)
}

window.electronAPI.extensionBridge.on('foundry:worktree-created', (data) => {
  const { runId, workspaceRoot, worktreePath, branch, label } = data as {
    runId: string
    workspaceRoot: string
    worktreePath: string
    branch: string
    label: string
  }
  if (!runId) return
  void (async () => {
    try {
      const { workspaces } = await window.electronAPI.workspace.list()
      const ws = (workspaces as { id: string; folderPath: string }[]).find(
        (w) => w.folderPath === workspaceRoot
      )
      if (!ws) return
      const result = await useWorkspaceStore.getState().createProject({
        workspaceId: ws.id,
        name: label,
        gitBranch: branch,
        worktreePath,
        isWorktree: true,
      })
      if ('project' in result) {
        await invoke('foundry:set-project-id', {
          runId,
          workspaceRoot,
          projectId: result.project.id,
        })
        useWorkspaceStore.getState().setActiveProject(result.project.id)
      }
    } catch {
      // best-effort
    }
  })()
})

window.electronAPI.extensionBridge.on('foundry:worktree-removed', (data) => {
  const { terminalProjectId } = data as { terminalProjectId?: string }
  if (!terminalProjectId) return
  void useWorkspaceStore
    .getState()
    .deleteProject(terminalProjectId)
    .catch(() => undefined)
})

// ── History global tab ─────────────────────────────────────────────────────────
function FoundryHistoryTab() {
  return React.createElement(HistoryView, { repoRoot: null })
}

registry.registerGlobalTab({
  id: 'foundry-history',
  label: 'Foundry History',
  icon: React.createElement(Bot, { size: 16 }),
  component: FoundryHistoryTab,
})

// ── Keyboard shortcuts ─────────────────────────────────────────────────────────

registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+A',
  description: 'Open Foundry panel',
  action() {
    const current = useExtensionRegistry.getState().activeGlobalTabId
    registry.setActiveGlobalTab(current === 'foundry' ? null : 'foundry')
  },
})

registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+R',
  description: 'Start new Foundry run',
  action() {
    registry.setActiveGlobalTab('foundry')
    setTimeout(
      () => window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'new-run' })),
      50
    )
  },
})

// ── Command palette entries ────────────────────────────────────────────────────

registry.registerCommand({
  id: 'foundry:open-panel',
  label: 'Open Foundry Panel',
  category: 'Foundry',
  shortcut: '⌘⇧A',
  action() {
    registry.setActiveGlobalTab('foundry')
  },
})

registry.registerCommand({
  id: 'foundry:new-run',
  label: 'Start New Foundry Run',
  category: 'Foundry',
  shortcut: '⌘⇧R',
  action() {
    registry.setActiveGlobalTab('foundry')
    setTimeout(
      () => window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'new-run' })),
      50
    )
  },
})

registry.registerCommand({
  id: 'foundry:open-history',
  label: 'Open Foundry History',
  category: 'Foundry',
  action() {
    registry.setActiveGlobalTab('foundry-history')
  },
})

registry.registerCommand({
  id: 'foundry:open-settings',
  label: 'Open Foundry Settings',
  category: 'Foundry',
  action() {
    registry.setActiveGlobalTab('foundry')
    setTimeout(
      () => window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'settings' })),
      50
    )
  },
})

registry.registerCommand({
  id: 'foundry:setup-harness',
  label: 'Set Up Foundry Harness',
  category: 'Foundry',
  action() {
    registry.setActiveGlobalTab('foundry')
    setTimeout(
      () => window.dispatchEvent(new CustomEvent('foundry:navigate', { detail: 'setup-wizard' })),
      50
    )
  },
})
