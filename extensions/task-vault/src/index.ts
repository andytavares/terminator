import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { registerVaultIpcHandlers, setVaultPath } from './ipc/vault.ipc.js'
import {
  registerProjectsIpcHandlers,
  setVaultPath as setProjectsVaultPath,
} from './ipc/projects.ipc.js'
import { registerLinksIpcHandlers, setVaultPath as setLinksVaultPath } from './ipc/links.ipc.js'
import { registerIcsIpcHandlers, setVaultPath as setIcsVaultPath } from './ipc/ics.ipc.js'
import { startWatcher, stopWatcher } from './vault/watcher.js'
import { buildIndex } from './vault/indexer.js'
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
          description: 'Absolute path to your markdown vault directory',
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

  if (vaultPath) {
    setVaultPath(vaultPath)
    setProjectsVaultPath(vaultPath)
    setLinksVaultPath(vaultPath)
    setIcsVaultPath(vaultPath)

    // Ensure vault directory structure exists
    await fs.mkdir(path.join(vaultPath, '.todo'), { recursive: true })
    await fs.mkdir(path.join(vaultPath, 'daily'), { recursive: true })

    // Create inbox.md if it doesn't exist
    const inboxFile = path.join(vaultPath, 'inbox.md')
    try {
      await fs.access(inboxFile)
    } catch {
      await fs.writeFile(inboxFile, '# Inbox\n\n', 'utf-8')
    }

    // Build initial index
    await buildIndex(vaultPath)

    // Start watcher
    await startWatcher(vaultPath, (_index) => {
      // TODO: push index-updated event to renderer windows
    })

    // Start ICS feed polling
    const feedUrls = api.settings.get<string[]>('terminator.task-vault.icsFeedUrls') ?? []
    const icsPollIntervalMs =
      (api.settings.get<number>('terminator.task-vault.icsPollIntervalMinutes') ?? 30) * 60 * 1000
    const icsCachePath = path.join(vaultPath, '.todo', 'ics-cache.json')
    if (feedUrls.length > 0) {
      startPolling(feedUrls, icsCachePath, icsPollIntervalMs)
    }
  }

  // Register IPC handlers
  const disposeIpc = registerVaultIpcHandlers()
  disposables.push({ dispose: disposeIpc })
  const disposeProjectsIpc = registerProjectsIpcHandlers()
  disposables.push({ dispose: disposeProjectsIpc })
  const disposeLinksIpc = registerLinksIpcHandlers()
  disposables.push({ dispose: disposeLinksIpc })
  const disposeIcsIpc = registerIcsIpcHandlers()
  disposables.push({ dispose: disposeIcsIpc })

  // Weekly review nudge
  if (vaultPath) {
    const reviewDay = parseInt(
      api.settings.get<string>('terminator.task-vault.weeklyReviewDay') ?? '0',
      10
    )
    scheduleWeeklyReviewNudge(api, vaultPath, reviewDay)
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

function scheduleWeeklyReviewNudge(api: ExtensionAPI, vaultPath: string, reviewDay: number): void {
  async function checkAndNudge() {
    const now = new Date()
    if (now.getDay() !== reviewDay) return
    // Check if review done this week
    const dailyDir = `${vaultPath}/daily`
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    try {
      const entries = await fs.readdir(dailyDir, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue
        const fileDate = new Date(entry.name.replace('.md', ''))
        if (fileDate < sevenDaysAgo) continue
        const content = await fs.readFile(`${dailyDir}/${entry.name}`, 'utf-8').catch(() => '')
        if (content.toLowerCase().includes('weekly review')) return
      }
    } catch {
      /* ignore */
    }
    api.notifications.showToast('info', 'Weekly review is ready — open Task Vault to start')
  }

  checkAndNudge().catch(() => {})
  reviewNudgeInterval = setInterval(
    () => {
      checkAndNudge().catch(() => {})
    },
    24 * 60 * 60 * 1000
  )
}

function openCaptureOverlay(_api: ExtensionAPI): void {
  // Implemented in renderer; main-side just signals renderer
  // Full BrowserWindow implementation handled by renderer overlay
}

export async function deactivate(): Promise<void> {
  await stopWatcher()
  stopPolling()
  if (reviewNudgeInterval !== null) {
    clearInterval(reviewNudgeInterval)
    reviewNudgeInterval = null
  }
  for (const d of disposables) {
    d.dispose()
  }
  disposables.length = 0
}
