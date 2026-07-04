import type { ExtensionAPI, Disposable, SettingDefinition } from '../../../src/main/extensions/api'
import { registerGitExtensionHandlers } from './ipc/git.ipc.js'
import { registerGithubHandlers } from './ipc/github.ipc.js'

// Every notification kind this extension ever raises, so the user can
// independently choose its delivery target(s) (system/in-app/toast) in this
// extension's own settings — core never knows these keys exist (Extension Isolation).
const NOTIFICATION_KEYS: { key: string; label: string }[] = [
  { key: 'sidebarToggleHint', label: 'Sidebar toggle hint' },
  { key: 'gitViewOpened', label: 'Git view opened' },
  { key: 'commitFailed', label: 'Commit failed' },
  { key: 'commitPushFailed', label: 'Committed but push failed' },
  { key: 'conflictResolveFailed', label: 'Could not resolve conflict' },
  { key: 'conflictUndoFailed', label: 'Could not undo conflict resolution' },
  { key: 'loadConflictsFailed', label: 'Could not load conflicts' },
  { key: 'noConflictsFound', label: 'No merge conflicts found' },
  { key: 'openResolverFailed', label: 'Could not open conflict resolver' },
  { key: 'resetFailed', label: 'Could not reset merge session' },
  { key: 'reloadConflictsFailed', label: 'Could not reload conflicts' },
  { key: 'startOverFailed', label: 'Start over failed' },
]

function buildNotificationSettingProperties(): Record<string, SettingDefinition> {
  const properties: Record<string, SettingDefinition> = {}
  for (const { key, label } of NOTIFICATION_KEYS) {
    properties[`terminator.git-integration.notify.${key}.system`] = {
      type: 'boolean',
      label: `${label} → System notification`,
      default: true,
    }
    properties[`terminator.git-integration.notify.${key}.center`] = {
      type: 'boolean',
      label: `${label} → In-app notification center`,
      default: true,
    }
    properties[`terminator.git-integration.notify.${key}.toast`] = {
      type: 'boolean',
      label: `${label} → Toast`,
      default: true,
    }
  }
  return properties
}

const disposables: Disposable[] = []

export function activate(api: ExtensionAPI): void {
  const enabled = api.settings.get<boolean>('terminator.git-integration.git.enabled') ?? true
  if (!enabled) return

  const registerFn = (
    channel: string,
    handler: (payload: unknown) => Promise<unknown> | unknown
  ) => {
    disposables.push(api.ipc.registerHandler(channel, handler))
  }
  registerGitExtensionHandlers(registerFn)
  registerGithubHandlers(registerFn, {
    getGhPath: () => api.settings.get<string>('terminator.git-integration.git.ghCliPath') ?? '',
    getToken: () => api.settings.get<string>('terminator.git-integration.git.githubToken') ?? '',
  })

  // Cross-iframe broadcast: any extension view can invoke this to open the
  // merge-flow view in the GitFullView iframe (which lives in a separate iframe context).
  disposables.push(
    api.ipc.registerHandler('git:request-merge-flow', (payload) => {
      const { repoRoot } = (payload ?? {}) as { repoRoot?: string }
      api.window.broadcast('git:merge-flow-open', { repoRoot: repoRoot ?? '' })
      return { ok: true }
    })
  )

  // Bridges this extension's renderer (an isolated webview, no direct access to
  // api.notifications) to the shared notification dispatcher.
  disposables.push(
    api.ipc.registerHandler('git:notify', (payload) => {
      const { type, title, key, message } = (payload ?? {}) as {
        type?: 'info' | 'success' | 'warning' | 'error'
        title?: string
        key?: string
        message?: string
      }
      if (!type || !title || !key) return { error: 'VALIDATION_ERROR' }
      api.notifications.createNotification({ type, title, key, message })
      return { ok: true }
    })
  )

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
          description: 'Path to the gh binary. Leave empty to auto-detect.',
          default: '',
        },
        'terminator.git-integration.git.githubToken': {
          type: 'string',
          label: 'GitHub token',
          description:
            'Personal access token or fine-grained token with repo scope. Used as GH_TOKEN when running gh commands.',
          default: '',
          secret: true,
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
        ...buildNotificationSettingProperties(),
      },
    })
  )

  disposables.push(
    api.sidebar.registerItem({
      id: 'git-sidebar-toggle',
      label: 'Git Changes',
      tooltip: 'Toggle Git Changes sidebar',
      onClick: () => {
        api.notifications.showToast(
          'info',
          'Toggle git sidebar via View menu or shortcut',
          'sidebarToggleHint'
        )
      },
    })
  )

  disposables.push(
    api.nativeMenu.addViewMenuItem({
      id: 'git-sidebar-toggle',
      label: 'Toggle Git Changes',
      accelerator: 'CmdOrCtrl+Shift+G',
      type: 'checkbox',
      panelId: 'terminator.git-integration',
      onClick: () => {
        api.window.broadcast('extension:toggle-panel', 'terminator.git-integration')
      },
    })
  )

  disposables.push(
    api.nativeMenu.addViewMenuItem({
      id: 'open-pr-review',
      label: 'Code Reviews in New Window',
      onClick: () => {
        api.window.openAuxiliary('pr-review', {})
      },
    })
  )

  disposables.push(
    api.ipc.registerHandler('window:open-pr-review', (payload) => {
      const { repoRoot, accentColor, prNumber, showOverview } = (payload ?? {}) as {
        repoRoot?: string
        accentColor?: string
        prNumber?: string
        showOverview?: string
      }
      const params: Record<string, string> = {
        repoRoot: repoRoot ?? '',
        accentColor: accentColor ?? '',
      }
      if (prNumber) {
        params.prNumber = prNumber
        params.showOverview = showOverview ?? 'false'
      }
      api.window.openAuxiliary('pr-review', params)
      return { ok: true }
    })
  )

  disposables.push(
    api.topBar.registerMenuItem({
      id: 'git-view',
      label: 'Git',
      tooltip: 'Open Git view',
      onClick: () => {
        api.notifications.showToast('info', 'Git view', 'gitViewOpened')
      },
    })
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
