import * as path from 'node:path'
import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { registerVaultIpcHandlers, setVaultPath } from './ipc/vault.ipc.js'
import {
  registerProjectsIpcHandlers,
  setVaultPath as setProjectsVaultPath,
} from './ipc/projects.ipc.js'
import { registerLinksIpcHandlers, setVaultPath as setLinksVaultPath } from './ipc/links.ipc.js'
import { registerIcsIpcHandlers, setVaultPath as setIcsVaultPath } from './ipc/ics.ipc.js'
import { initDb, closeDb } from './vault/db.js'
import { startPolling, stopPolling } from './ics/fetcher.js'

const disposables: Disposable[] = []

export async function activate(api: ExtensionAPI): Promise<void> {
  // Register settings
  disposables.push(
    api.settings.register({
      label: 'Task Vault',
      properties: {
        'terminator.task-vault.vaultPath': {
          type: 'string',
          label: 'Vault Path',
          description: 'Absolute path to your vault directory',
          default: '',
        },
        'terminator.task-vault.captureHotkey': {
          type: 'string',
          label: 'Capture Hotkey',
          description: 'Global shortcut to open the quick capture overlay',
          default: 'CommandOrControl+Shift+Space',
        },
        'terminator.task-vault.staleThresholdDays': {
          type: 'number',
          label: 'Stale Project Threshold (days)',
          description: 'Days without modification before a project is considered stale',
          default: 14,
          min: 1,
          max: 365,
        },
        'terminator.task-vault.weeklyReviewDay': {
          type: 'string',
          label: 'Weekly Review Day',
          description: 'Day of the week for weekly review reminder (0=Sun, 6=Sat)',
          default: '0',
        },
        'terminator.task-vault.contexts': {
          type: 'string',
          label: 'Contexts',
          description:
            'Comma-separated list of contexts shown in the + picker (e.g. home,work,computer,phone,errands)',
          default: 'home,work,computer,phone,errands',
        },
        'terminator.task-vault.mcpAutoExecute.capture': {
          type: 'boolean',
          label: 'MCP Auto-Execute: capture',
          description: 'If enabled, MCP capture tool writes immediately without confirmation',
          default: false,
        },
        'terminator.task-vault.mcpAutoExecute.add_task': {
          type: 'boolean',
          label: 'MCP Auto-Execute: add_task',
          default: false,
        },
        'terminator.task-vault.mcpAutoExecute.complete_task': {
          type: 'boolean',
          label: 'MCP Auto-Execute: complete_task',
          default: false,
        },
        'terminator.task-vault.mcpAutoExecute.migrate_task': {
          type: 'boolean',
          label: 'MCP Auto-Execute: migrate_task',
          default: false,
        },
        'terminator.task-vault.mcpAutoExecute.process_inbox_item': {
          type: 'boolean',
          label: 'MCP Auto-Execute: process_inbox_item',
          default: false,
        },
      },
    })
  )

  const vaultPath = api.settings.get<string>('terminator.task-vault.vaultPath') ?? ''

  // Register IPC handlers first so they're always available
  const disposeIpc = registerVaultIpcHandlers()
  disposables.push({ dispose: disposeIpc })
  const disposeProjectsIpc = registerProjectsIpcHandlers()
  disposables.push({ dispose: disposeProjectsIpc })
  const disposeLinksIpc = registerLinksIpcHandlers()
  disposables.push({ dispose: disposeLinksIpc })
  const disposeIcsIpc = registerIcsIpcHandlers()
  disposables.push({ dispose: disposeIcsIpc })

  if (vaultPath) {
    setVaultPath(vaultPath)
    setProjectsVaultPath(vaultPath)
    setLinksVaultPath(vaultPath)
    setIcsVaultPath(vaultPath)

    try {
      initDb(vaultPath)
    } catch (err) {
      console.error('[task-vault] Failed to initialize SQLite DB:', err)
    }

    // Start ICS feed polling
    const feedUrls = api.settings.get<string[]>('terminator.task-vault.icsFeedUrls') ?? []
    const icsPollIntervalMs =
      (api.settings.get<number>('terminator.task-vault.icsPollIntervalMinutes') ?? 30) * 60 * 1000
    const icsCachePath = path.join(vaultPath, '.todo', 'ics-cache.json')
    if (feedUrls.length > 0) {
      startPolling(feedUrls, icsCachePath, icsPollIntervalMs)
    }
  }

  // Weekly review nudge
  if (vaultPath) {
    const reviewDay = parseInt(
      api.settings.get<string>('terminator.task-vault.weeklyReviewDay') ?? '0',
      10
    )
    scheduleWeeklyReviewNudge(api, reviewDay)
  }

  // Register capture hotkey
  const captureHotkey =
    api.settings.get<string>('terminator.task-vault.captureHotkey') ??
    'CommandOrControl+Shift+Space'
  try {
    const hotkeyDisposable = api.globalShortcut.register(captureHotkey, () => {
      openCaptureOverlay(api)
    })
    disposables.push(hotkeyDisposable)
  } catch {
    // Hotkey may already be taken; continue without it
  }
}

let reviewNudgeInterval: ReturnType<typeof setInterval> | null = null

function scheduleWeeklyReviewNudge(api: ExtensionAPI, reviewDay: number): void {
  function checkAndNudge() {
    const now = new Date()
    if (now.getDay() !== reviewDay) return
    api.notifications.showToast('info', 'Weekly review is ready — open Task Vault to start')
  }

  checkAndNudge()
  reviewNudgeInterval = setInterval(
    () => {
      checkAndNudge()
    },
    24 * 60 * 60 * 1000
  )
}

function openCaptureOverlay(_api: ExtensionAPI): void {
  // Implemented in renderer; main-side just signals renderer
}

export async function deactivate(): Promise<void> {
  stopPolling()
  closeDb()
  if (reviewNudgeInterval !== null) {
    clearInterval(reviewNudgeInterval)
    reviewNudgeInterval = null
  }
  for (const d of disposables) {
    d.dispose()
  }
  disposables.length = 0
}
