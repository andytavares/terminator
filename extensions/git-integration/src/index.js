'use strict'

const { BrowserWindow } = require('electron')

const disposables = []
let refreshTimer = null

function sendToRenderer(channel, data) {
  const wins = BrowserWindow.getAllWindows()
  if (wins[0]) wins[0].webContents.send(channel, data)
}

function activate(api) {
  const enabled = api.settings.get('terminator.git-integration.git.enabled') ?? true
  if (!enabled) return

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

  // Register sidebar item in left sidebar
  disposables.push(
    api.sidebar.registerItem({
      id: 'git-sidebar-toggle',
      label: 'Git Changes',
      tooltip: 'Toggle Git Changes sidebar',
      onClick: () => sendToRenderer('extension:toggle-panel', { panelId: 'git-changes' }),
    })
  )

  // Register native View menu item (Cmd+Shift+G)
  try {
    disposables.push(
      api.nativeMenu.addViewMenuItem({
        id: 'git-sidebar-toggle',
        label: 'Toggle Git Sidebar',
        accelerator: 'CmdOrCtrl+Shift+G',
        onClick: () => sendToRenderer('extension:toggle-panel', { panelId: 'git-changes' }),
      })
    )
  } catch {
    // Menu may not be available in test environments
  }

  // Register top-bar Git tab (opens the full Git view in the project tab bar)
  disposables.push(
    api.topBar.registerMenuItem({
      id: 'git-view',
      label: 'Git',
      tooltip: 'Open Git view',
      onClick: () => sendToRenderer('extension:select-project-tab', { tabId: 'git' }),
    })
  )

  // Subscribe to file system changes — renderer handles polling itself,
  // but we notify it when files change so it can refresh immediately
  disposables.push(
    api.fs.watch((event) => {
      sendToRenderer('git:fs-changed', event)
    })
  )
}

function deactivate() {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  disposables.forEach((d) => {
    try { d.dispose() } catch { /* ignore */ }
  })
  disposables.length = 0
}

module.exports = { activate, deactivate }
