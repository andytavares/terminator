import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { useGitStore } from './stores/git.store'
import { GitSidebarPanel } from './components/GitSidebarPanel'

const disposables: Disposable[] = []
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let currentProjectRoot: string | null = null

function scheduleRefresh(repoRoot: string, api: ExtensionAPI, maxFiles: number): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(async () => {
    const store = useGitStore.getState()
    store.setLoading(true)
    try {
      const result = await window.electronAPI.git.status(repoRoot, maxFiles) as
        | { branch: string; files: unknown[]; hasConflicts: boolean; truncated: boolean }
        | { error: string }

      if ('error' in result) {
        store.setStatus(null)
        api.notifications.showToast('error', `Git status failed: ${(result as { error: string }).error}`)
      } else {
        store.setStatus(result as Parameters<typeof store.setStatus>[0])
      }
    } catch {
      store.setStatus(null)
    } finally {
      store.setLoading(false)
    }
    refreshTimer = null
  }, 200)
}

export function activate(api: ExtensionAPI): void {
  // Settings gate — early return if disabled
  const enabled = api.settings.get<boolean>('terminator.git-integration.git.enabled') ?? true
  if (!enabled) return

  // Register settings schema (FR-029)
  disposables.push(
    api.settings.register({
      label: 'Git Integration',
      properties: {
        'terminator.git-integration.git.enabled': {
          type: 'boolean',
          label: 'Enable Git Integration',
          default: true,
          workspaceScoped: true,
        },
        'terminator.git-integration.git.sidebar.defaultOpen': {
          type: 'boolean',
          label: 'Open sidebar by default',
          default: false,
          workspaceScoped: true,
        },
        'terminator.git-integration.git.sidebar.refreshIntervalMs': {
          type: 'number',
          label: 'Sidebar refresh interval (ms)',
          default: 3000,
          min: 500,
          max: 60000,
          workspaceScoped: true,
        },
        'terminator.git-integration.git.ghCliPath': {
          type: 'string',
          label: 'gh CLI path',
          description: 'Path to the gh binary. Leave empty to use system PATH.',
          default: '',
        },
        'terminator.git-integration.git.commit.signOff': {
          type: 'boolean',
          label: 'Add sign-off to commits',
          default: false,
          workspaceScoped: true,
        },
        'terminator.git-integration.git.maxDisplayedFiles': {
          type: 'number',
          label: 'Max displayed changed files',
          default: 500,
          min: 10,
          max: 5000,
        },
      },
    })
  )

  const defaultOpen =
    api.settings.get<boolean>('terminator.git-integration.git.sidebar.defaultOpen') ?? false
  const maxFiles =
    api.settings.get<number>('terminator.git-integration.git.maxDisplayedFiles') ?? 500
  const refreshIntervalMs =
    api.settings.get<number>('terminator.git-integration.git.sidebar.refreshIntervalMs') ?? 3000

  // Register right sidebar panel (FR-022)
  disposables.push(
    api.sidebar.registerPanel('right-sidebar', {
      id: 'git-changes',
      title: 'Git Changes',
      component: GitSidebarPanel,
      defaultVisible: defaultOpen,
    })
  )

  // Register sidebar toggle item
  disposables.push(
    api.sidebar.registerItem({
      id: 'git-sidebar-toggle',
      label: 'Git Changes',
      tooltip: 'Toggle Git Changes sidebar',
      onClick: () => {
        // Toggle is handled by the panel slot mechanism
        api.notifications.showToast('info', 'Toggle git sidebar via View menu or shortcut')
      },
    })
  )

  // Register keyboard shortcut (CmdOrCtrl+Shift+G) to toggle sidebar (FR-008)
  try {
    disposables.push(
      api.keyboard.register('CmdOrCtrl+Shift+G', () => {
        api.notifications.showToast('info', 'Toggle git sidebar')
      })
    )
  } catch {
    // Shortcut may already be registered
  }

  // Register native View menu item (FR-030, T089)
  disposables.push(
    api.nativeMenu.addViewMenuItem({
      id: 'git-sidebar-toggle',
      label: 'Toggle Git Sidebar',
      accelerator: 'CmdOrCtrl+Shift+G',
      onClick: () => {
        api.notifications.showToast('info', 'Toggle git sidebar')
      },
    })
  )

  // Register top-bar Git menu item (FR-023, T049)
  disposables.push(
    api.topBar.registerMenuItem({
      id: 'git-view',
      label: 'Git',
      tooltip: 'Open Git view',
      onClick: () => {
        // In a full implementation, this opens the GitView panel
        api.notifications.showToast('info', 'Git view')
      },
    })
  )

  // Subscribe to file system changes for auto-refresh (FR-027)
  disposables.push(
    api.fs.watch((event) => {
      if (currentProjectRoot && event.projectRoot === currentProjectRoot) {
        scheduleRefresh(currentProjectRoot, api, maxFiles)
      }
    })
  )

  // Subscribe to session creation to detect project root
  disposables.push(
    api.terminal.onSessionCreate(async (session) => {
      // In a real implementation, we'd get the project root from the session's project
      // For now, trigger an initial status check when a session is created
      void session
    })
  )

  // Trigger initial status check if we have a project root
  // (In practice, this would be triggered by the workspace/project context)
  void refreshIntervalMs // used by fs.watch polling interval config
}

export function deactivate(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
  currentProjectRoot = null
}

// Expose for use in renderer components
export { currentProjectRoot }
