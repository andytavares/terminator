import { BrowserWindow, ipcMain } from 'electron'
import type { ExtensionAPI, ExtensionDB, Disposable } from '../../../src/main/extensions/api'
import { DEFAULT_CAPTURE_HOTKEY } from './constants.js'
import { registerVaultIpcHandlers } from './ipc/vault.ipc.js'
import { registerProjectsIpcHandlers } from './ipc/projects.ipc.js'
import { registerLinksIpcHandlers } from './ipc/links.ipc.js'
import { registerKanbanIpcHandlers } from './ipc/kanban.ipc.js'
import { registerAdminIpcHandlers } from './ipc/admin.ipc.js'
import { applyTaskVaultSchema, applyTaskVaultMigrations } from './vault/db.js'
import { backfillRecurringTasks } from './vault/ensure-next-occurrence.js'
import { startTaskScheduler, setSchedulerTick } from './notifications/task-scheduler.js'

const disposables: Disposable[] = []
let _api: ExtensionAPI | null = null
let _schedulerStarted = false
let _pendingCapture = false
let _pendingCaptureTimer: ReturnType<typeof setTimeout> | null = null

function maybeStartScheduler(db: ExtensionDB): void {
  if (_schedulerStarted || !_api) return
  try {
    const scheduler = startTaskScheduler(_api, db)
    _schedulerStarted = true
    disposables.push({ dispose: scheduler.dispose })
    setSchedulerTick(scheduler.tick)
  } catch {
    // best-effort
  }
}

export async function activate(api: ExtensionAPI): Promise<void> {
  _api = api
  const db: ExtensionDB = api.db

  disposables.push(
    api.settings.register({
      label: 'Task Vault',
      properties: {
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
        'terminator.task-vault.dueDateAlertTime': {
          type: 'string',
          label: 'Due Date Alert Time',
          description:
            'Time of day to send due-date notifications (24-hour HH:MM format, e.g. 09:00)',
          default: '09:00',
        },
        'terminator.task-vault.db.reinit': {
          type: 'action',
          label: 'Re-initialize',
          description: 'Re-run schema checks and startup gap-fill. Use if tasks stop loading.',
          channel: 'task-vault:db.reinit',
          default: null,
        },
        'terminator.task-vault.db.reset': {
          type: 'action',
          label: 'Reset (delete all data)',
          description: 'Permanently delete all tasks and projects. This cannot be undone.',
          channel: 'task-vault:db.reset',
          danger: true,
          confirmMessage:
            'This will permanently delete ALL your tasks and projects. This cannot be undone. Continue?',
          default: null,
        },
      },
    })
  )

  ipcMain.handle('task-vault:db.reinit', async () => {
    try {
      await applyTaskVaultSchema(db)
      await applyTaskVaultMigrations(db)
      await backfillRecurringTasks(db)
      maybeStartScheduler(db)
      return { data: { ok: true } }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle('task-vault:db.reset', async () => {
    try {
      // Delete rows in FK-safe order; do not drop tables — the settings table is
      // shared with other extensions in the unified PGlite database.
      await db.exec(`
        DELETE FROM tasks;
        DELETE FROM projects;
        DELETE FROM areas;
        DELETE FROM settings;
      `)
      await applyTaskVaultSchema(db)
      await applyTaskVaultMigrations(db)
      maybeStartScheduler(db)
      return { data: { ok: true } }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  disposables.push({
    dispose: () => {
      ipcMain.removeHandler('task-vault:db.reinit')
      ipcMain.removeHandler('task-vault:db.reset')
    },
  })

  const disposeIpc = registerVaultIpcHandlers(db)
  disposables.push({ dispose: disposeIpc })
  const disposeProjectsIpc = registerProjectsIpcHandlers(db)
  disposables.push({ dispose: disposeProjectsIpc })
  const disposeLinksIpc = registerLinksIpcHandlers(db)
  disposables.push({ dispose: disposeLinksIpc })
  const disposeKanbanIpc = registerKanbanIpcHandlers(db)
  disposables.push({ dispose: disposeKanbanIpc })
  const disposeAdminIpc = registerAdminIpcHandlers(db)
  disposables.push({ dispose: disposeAdminIpc })

  try {
    await applyTaskVaultSchema(db)
    await applyTaskVaultMigrations(db)
    await backfillRecurringTasks(db)
    maybeStartScheduler(db)
  } catch (err) {
    console.error('[task-vault] Failed to initialize schema:', err)
    api.notifications.showToast(
      'error',
      'Task Vault: database schema failed to initialize. Restart the app — if the problem persists, check the logs.'
    )
  }

  disposables.push(
    api.ipc.registerHandler('task-vault:navigate-to-terminal', (data) => {
      const { sessionId, projectId } = (data ?? {}) as {
        sessionId?: string
        projectId?: string
      }
      if (!sessionId || !projectId) return { ok: false, error: 'missing sessionId or projectId' }
      api.window.broadcast('terminal:navigate-to-session', { sessionId, projectId })
      return { ok: true }
    })
  )

  // Pending navigation from CalendarDrawer — consumed by TaskVaultView on cold-start mount.
  let pendingNavigation: { date?: string; taskId?: string } | null = null

  disposables.push(
    api.ipc.registerHandler('task-vault:open-panel', (data) => {
      const { date, taskId } = (data ?? {}) as { date?: string; taskId?: string }
      api.window.broadcast('extension:activate-global-tab', 'terminator.task-vault')
      if (date ?? taskId) {
        pendingNavigation = { date, taskId }
        api.window.broadcast('task-vault:navigate', { date, taskId })
      }
      return { ok: true }
    })
  )

  disposables.push(
    api.ipc.registerHandler('task-vault:pop-pending-navigation', () => {
      const nav = pendingNavigation
      pendingNavigation = null
      return nav
    })
  )

  disposables.push(
    api.nativeMenu.addViewMenuItem({
      id: 'vault-calendar-toggle',
      label: 'Toggle Vault Calendar',
      type: 'checkbox',
      panelId: 'terminator.task-vault',
      onClick: () => {
        api.window.broadcast('extension:toggle-panel', 'terminator.task-vault')
      },
    })
  )

  const reviewDay = parseInt(
    api.settings.get<string>('terminator.task-vault.weeklyReviewDay') ?? '0',
    10
  )
  scheduleWeeklyReviewNudge(api, reviewDay)

  // Renderer calls this on mount to pick up a capture triggered before the view existed.
  disposables.push(
    api.ipc.registerHandler('task-vault:ui.consumePendingCapture', () => {
      const pending = _pendingCapture
      _pendingCapture = false
      if (_pendingCaptureTimer !== null) {
        clearTimeout(_pendingCaptureTimer)
        _pendingCaptureTimer = null
      }
      return { data: { pending } }
    })
  )

  try {
    const hotkeyDisposable = api.globalShortcut.register(DEFAULT_CAPTURE_HOTKEY, () => {
      openCaptureOverlay(api)
    })
    disposables.push(hotkeyDisposable)
    console.log(`[task-vault] Global capture shortcut registered: ${DEFAULT_CAPTURE_HOTKEY}`)
  } catch (err) {
    console.warn(
      `[task-vault] Could not register global shortcut "${DEFAULT_CAPTURE_HOTKEY}" — claimed by another app.`,
      err
    )
    api.notifications.showToast(
      'warning',
      `Task Vault: global shortcut "${DEFAULT_CAPTURE_HOTKEY}" is in use by another app.`
    )
  }
}

let reviewNudgeInterval: ReturnType<typeof setInterval> | null = null

function scheduleWeeklyReviewNudge(api: ExtensionAPI, reviewDay: number): void {
  if (reviewNudgeInterval !== null) {
    clearInterval(reviewNudgeInterval)
    reviewNudgeInterval = null
  }
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

function openCaptureOverlay(api: ExtensionAPI): void {
  // Broadcast to any already-running extension view immediately.
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send('task-vault:push:open-capture')
  }
  // Activate the global tab — this creates the WebContentsView if it doesn't exist yet.
  api.window.broadcast('extension:activate-global-tab', 'terminator.task-vault')
  // Transfer keyboard focus to the task-vault WebContentsView so Escape works immediately.
  api.window.focusSelf('main')
  // Set pending flag so the renderer shows the modal on first load.
  // Auto-expire after 5 s so a late manual panel open doesn't surprise the user.
  _pendingCapture = true
  if (_pendingCaptureTimer !== null) clearTimeout(_pendingCaptureTimer)
  _pendingCaptureTimer = setTimeout(() => {
    _pendingCapture = false
    _pendingCaptureTimer = null
  }, 5000)
}

export async function deactivate(): Promise<void> {
  _api = null
  _schedulerStarted = false
  _pendingCapture = false
  if (_pendingCaptureTimer !== null) {
    clearTimeout(_pendingCaptureTimer)
    _pendingCaptureTimer = null
  }
  if (reviewNudgeInterval !== null) {
    clearInterval(reviewNudgeInterval)
    reviewNudgeInterval = null
  }
  for (const d of disposables) {
    d.dispose()
  }
  disposables.length = 0
}
