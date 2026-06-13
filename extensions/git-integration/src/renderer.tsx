// Extension renderer entry point — self-registers into the core extension registry.
// Discovered automatically via Vite glob import in src/renderer/extensions/loader.ts.
// The core app never imports this file directly.

import React from 'react'
import { GitPullRequest } from 'lucide-react'
import 'highlight.js/styles/atom-one-dark.css'
import { useExtensionRegistry } from '../../../src/renderer/extensions/registry'
import { useWorkspaceStore } from '../../../src/renderer/stores/workspace.store'
import { GitSidebarPanel } from './components/GitSidebarPanel'
import { GitFullView } from './components/GitFullView'
import { PrReviewTab } from './components/pr-review/PrReviewTab'

const registry = useExtensionRegistry.getState()

// Wrapper reads the active project's repo root from the workspace store so
// PrReviewTab can operate as a global (workspace-level) tab with no prop drilling.
function PrReviewGlobalTab(): React.JSX.Element {
  const { workspaces, activeWorkspaceId, activeProjectId, projectsByWorkspaceId } =
    useWorkspaceStore()
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  const workspaceProjects = activeWorkspaceId
    ? (projectsByWorkspaceId.get(activeWorkspaceId) ?? [])
    : []
  const activeProject = workspaceProjects.find((p) => p.id === activeProjectId) ?? null
  const repoRoot = activeProject?.worktreePath ?? activeWorkspace?.folderPath ?? null
  return <PrReviewTab repoRoot={repoRoot} />
}

registry.registerSidebarPanel({
  id: 'git-changes',
  label: 'Git Changes',
  component: GitSidebarPanel,
})

registry.registerProjectTab({
  id: 'git',
  label: 'Git',
  component: GitFullView,
})

registry.registerWorkspaceTab({
  id: 'code-reviews',
  label: 'Code Reviews',
  icon: React.createElement(GitPullRequest),
  component: PrReviewGlobalTab,
})

registry.registerWindowView(
  'pr-review',
  PrReviewTab as React.ComponentType<{ repoRoot: string | null }>
)

// Extension owns its own keyboard shortcuts — the core app has no knowledge of these
registry.registerKeyboardShortcut({
  accelerator: 'CmdOrCtrl+Shift+G',
  description: 'Toggle Git Changes sidebar',
  action: () => useExtensionRegistry.getState().togglePanel('git-changes'),
})

registry.registerKeyboardShortcut({
  accelerator: '[',
  description: 'PR Review: go to previous file',
  action: () => {
    const event = new CustomEvent('pr-review:prev-file')
    window.dispatchEvent(event)
  },
})

registry.registerKeyboardShortcut({
  accelerator: '1',
  description: 'PR Review: mark file viewed and go to next',
  action: () => {
    const event = new CustomEvent('pr-review:mark-viewed-next')
    window.dispatchEvent(event)
  },
})
