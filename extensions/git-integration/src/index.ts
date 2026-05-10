import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { registerGitExtensionHandlers } from './ipc/git.ipc.js'
import { registerGithubHandlers } from './ipc/github.ipc.js'

const disposables: Disposable[] = []

export function activate(api: ExtensionAPI): void {
  const enabled = api.settings.get<boolean>('terminator.git-integration.git.enabled') ?? true
  if (!enabled) return

  const registerFn = (channel: string, handler: (payload: unknown) => Promise<unknown> | unknown) => {
    disposables.push(api.ipc.registerHandler(channel, handler))
  }
  registerGitExtensionHandlers(registerFn)
  registerGithubHandlers(registerFn)

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

  disposables.push(
    api.sidebar.registerItem({
      id: 'git-sidebar-toggle',
      label: 'Git Changes',
      tooltip: 'Toggle Git Changes sidebar',
      onClick: () => {
        api.notifications.showToast('info', 'Toggle git sidebar via View menu or shortcut')
      },
    })
  )

  try {
    disposables.push(
      api.keyboard.register('CmdOrCtrl+Shift+G', () => {
        api.notifications.showToast('info', 'Toggle git sidebar')
      })
    )
  } catch {
    // Shortcut may already be registered
  }

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

  disposables.push(
    api.topBar.registerMenuItem({
      id: 'git-view',
      label: 'Git',
      tooltip: 'Open Git view',
      onClick: () => {
        api.notifications.showToast('info', 'Git view')
      },
    })
  )
}

export function deactivate(): void {
  disposables.forEach((d) => d.dispose())
  disposables.length = 0
}
