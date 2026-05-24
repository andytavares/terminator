import type { ExtensionAPI, Disposable } from '../../../src/main/extensions/api'
import { registerVaultIpcHandlers, setVaultPath } from './ipc/vault.ipc.js'
import {
  registerProjectsIpcHandlers,
  setVaultPath as setProjectsVaultPath,
} from './ipc/projects.ipc.js'
import { registerLinksIpcHandlers, setVaultPath as setLinksVaultPath } from './ipc/links.ipc.js'
import { registerKanbanIpcHandlers, setVaultPath as setKanbanVaultPath } from './ipc/kanban.ipc.js'
import { registerAdminIpcHandlers } from './ipc/admin.ipc.js'
import { initDb, closeDb } from './vault/db.js'

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
  const disposeKanbanIpc = registerKanbanIpcHandlers()
  disposables.push({ dispose: disposeKanbanIpc })
  const disposeAdminIpc = registerAdminIpcHandlers()
  disposables.push({ dispose: disposeAdminIpc })
  if (vaultPath) {
    setVaultPath(vaultPath)
    setProjectsVaultPath(vaultPath)
    setLinksVaultPath(vaultPath)
    setKanbanVaultPath(vaultPath)

    try {
      initDb(vaultPath)
    } catch (err) {
      console.error('[task-vault] Failed to initialize SQLite DB:', err)
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
