import { z } from 'zod'
import { createIpcRegistrar, noPayload } from '@terminator/extension-sdk'
import type {
  ExtensionAPI,
  ExtensionDB,
  Disposable,
  SettingDefinition,
  TaskVaultAPI,
} from '@terminator/extension-sdk'
import { DEFAULT_CAPTURE_HOTKEY } from './constants.js'
import { registerVaultIpcHandlers } from './ipc/vault.ipc.js'
import { registerProjectsIpcHandlers } from './ipc/projects.ipc.js'
import { registerLinksIpcHandlers } from './ipc/links.ipc.js'
import { registerKanbanIpcHandlers } from './ipc/kanban.ipc.js'
import { errorResult } from './ipc/register.js'
import { registerAdminIpcHandlers } from './ipc/admin.ipc.js'
import { registerWeeklyReviewIpcHandlers } from './ipc/weekly-review.ipc.js'
import { applyTaskVaultSchema } from './vault/db.js'
import {
  migrateStoredStaleThreshold,
  STALE_THRESHOLD,
  STALE_THRESHOLD_KEY,
} from './stale-threshold.js'
import { backfillRecurringTasks } from './vault/ensure-next-occurrence.js'
import {
  bindBroadcast,
  startTaskScheduler,
  setSchedulerTick,
} from './notifications/task-scheduler.js'
import { openInVault, popPendingNavigation } from './navigation.js'
import { zonedNow } from './vault/clock.js'
import { startHomePublisher, type HomePublisher } from './home/publisher.js'
import { OPEN_COMMAND } from './home/feed.js'

// Every notification kind task-vault ever raises, so the user can independently
// choose its delivery target(s) (system/in-app/toast) in this extension's own
// settings — core never knows these keys exist (Extension Isolation).
const NOTIFICATION_KEYS: { key: string; label: string }[] = [
  { key: 'schemaInitFailed', label: 'Database schema failed to initialize' },
  { key: 'globalShortcutTaken', label: 'Global capture shortcut unavailable' },
  { key: 'weeklyReviewReady', label: 'Weekly review ready' },
  { key: 'taskCompleted', label: 'Task completed' },
  { key: 'taskMigrated', label: 'Task migrated' },
  { key: 'taskArchived', label: 'Task archived (cancelled)' },
  { key: 'taskReopened', label: 'Task reopened' },
  { key: 'taskBlocked', label: 'Task blocked' },
  { key: 'taskUnblocked', label: 'Task unblocked' },
  { key: 'taskMovedToBacklog', label: 'Task moved to backlog' },
  { key: 'areaArchived', label: 'Area archived' },
  { key: 'projectArchived', label: 'Project archived' },
  { key: 'dueTaskReminder', label: 'Due / overdue task reminder' },
  { key: 'blockedTaskCheckin', label: 'Blocked task check-in' },
  { key: 'recurrenceSet', label: 'Recurrence set' },
  { key: 'recurrenceRemoved', label: 'Recurrence removed' },
  { key: 'staleTaskBacklogFailed', label: 'Stale task: move to backlog failed' },
  { key: 'staleTaskDeleteFailed', label: 'Stale task: delete failed' },
  { key: 'staleTaskResetFailed', label: 'Stale task: reset failed' },
  { key: 'terminalLinkSaveFailed', label: 'Terminal link save failed' },
]

function buildNotificationSettingProperties(): Record<string, SettingDefinition> {
  const properties: Record<string, SettingDefinition> = {}
  for (const { key, label } of NOTIFICATION_KEYS) {
    properties[`terminator.task-vault.notify.${key}.system`] = {
      type: 'boolean',
      label: `${label} → System notification`,
      default: true,
    }
    properties[`terminator.task-vault.notify.${key}.center`] = {
      type: 'boolean',
      label: `${label} → In-app notification center`,
      default: true,
    }
    properties[`terminator.task-vault.notify.${key}.toast`] = {
      type: 'boolean',
      label: `${label} → Toast`,
      default: true,
    }
  }
  return properties
}

/** The extension's own settings, before the per-notification delivery toggles. */
const BASE_SETTINGS: Record<string, SettingDefinition> = {
  [STALE_THRESHOLD_KEY]: {
    type: 'number',
    label: 'Stale Task Threshold (days)',
    description:
      'Days a task can roll over on Today before it is marked stale and listed in the weekly review',
    default: STALE_THRESHOLD.default,
    min: STALE_THRESHOLD.min,
    max: STALE_THRESHOLD.max,
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
    description: 'Time of day to send due-date notifications (24-hour HH:MM format, e.g. 09:00)',
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
}

/** The terminal a task links to, for jumping to its tab. */
const TerminalTarget = z.object({ sessionId: z.string().min(1), projectId: z.string().min(1) })
/** The day or task the vault panel opens on. */
const VaultTarget = z
  .object({ date: z.string().optional(), taskId: z.string().optional() })
  .default({})

type OwnIpc = ReturnType<typeof createIpcRegistrar>

const disposables: Disposable[] = []
let _api: ExtensionAPI | null = null
let _schedulerStarted = false
let _stopScheduler: (() => Promise<void>) | null = null
let _pendingCapture = false
let _pendingCaptureTimer: ReturnType<typeof setTimeout> | null = null

function maybeStartScheduler(db: ExtensionDB): void {
  if (_schedulerStarted || !_api) return
  try {
    const scheduler = startTaskScheduler(_api, db)
    _schedulerStarted = true
    _stopScheduler = scheduler.dispose
    setSchedulerTick(scheduler.tick)
  } catch {
    // best-effort
  }
}

/** The settings page's Re-initialize and Reset actions. */
function registerDbActions(ownIpc: OwnIpc, db: ExtensionDB): void {
  ownIpc.handle('task-vault:db.reinit', noPayload, async () => {
    await applyTaskVaultSchema(db)
    await backfillRecurringTasks(db)
    maybeStartScheduler(db)
    return { data: { ok: true } }
  })
  ownIpc.handle('task-vault:db.reset', noPayload, async () => {
    // Delete rows in FK-safe order; do not drop tables — the settings table is
    // shared with other extensions in the unified app database, so only this
    // extension's own rows go.
    await db.exec(`
        DELETE FROM area_archive_changes;
        DELETE FROM tasks;
        DELETE FROM projects;
        DELETE FROM areas;
        DELETE FROM settings WHERE extension_id = 'task-vault';
      `)
    await applyTaskVaultSchema(db)
    maybeStartScheduler(db)
    return { data: { ok: true } }
  })
}

const FEATURE_IPC = [
  registerVaultIpcHandlers,
  registerProjectsIpcHandlers,
  registerLinksIpcHandlers,
  registerKanbanIpcHandlers,
  registerAdminIpcHandlers,
  registerWeeklyReviewIpcHandlers,
]

function registerFeatureIpc(api: ExtensionAPI, db: ExtensionDB): void {
  for (const register of FEATURE_IPC) disposables.push({ dispose: register(api, db) })
}

async function initializeSchema(api: ExtensionAPI, db: ExtensionDB): Promise<void> {
  try {
    await applyTaskVaultSchema(db)
    await migrateStoredStaleThreshold(api, db)
    await backfillRecurringTasks(db)
    maybeStartScheduler(db)
  } catch (err) {
    console.error('[task-vault] Failed to initialize schema:', err)
    api.notifications.showToast(
      'error',
      'Task Vault: database schema failed to initialize. Restart the app — if the problem persists, check the logs.',
      'schemaInitFailed'
    )
  }
}

function registerNavigation(ownIpc: OwnIpc, api: ExtensionAPI): void {
  ownIpc.handle('task-vault:navigate-to-terminal', TerminalTarget, ({ sessionId, projectId }) => {
    api.window.broadcast('terminal:navigate-to-session', { sessionId, projectId })
    return { ok: true }
  })
  ownIpc.handle('task-vault:open-panel', VaultTarget, ({ date, taskId }) => {
    openInVault(api, { date, taskId })
    return { ok: true }
  })
  // Consumed by TaskVaultView on cold-start mount, when the broadcast above
  // was sent before its WebContentsView existed to hear it.
  ownIpc.handle('task-vault:pop-pending-navigation', noPayload, () => popPendingNavigation())
}

function addCalendarMenuItem(api: ExtensionAPI): void {
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
}

function clearPendingCaptureTimer(): void {
  if (_pendingCaptureTimer === null) return
  clearTimeout(_pendingCaptureTimer)
  _pendingCaptureTimer = null
}

/** Renderer calls this on mount to pick up a capture triggered before the view existed. */
function registerPendingCapture(ownIpc: OwnIpc): void {
  ownIpc.handle('task-vault:ui.consumePendingCapture', noPayload, () => {
    const pending = _pendingCapture
    _pendingCapture = false
    clearPendingCaptureTimer()
    return { data: { pending } }
  })
}

async function registerCaptureShortcut(api: ExtensionAPI): Promise<void> {
  try {
    const hotkeyDisposable = await api.globalShortcut.register(DEFAULT_CAPTURE_HOTKEY, () => {
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
      `Task Vault: global shortcut "${DEFAULT_CAPTURE_HOTKEY}" is in use by another app.`,
      'globalShortcutTaken'
    )
  }
}

/** Registered unconditionally: the quick-actions command must not depend on the global hotkey
 *  having claimed its accelerator. */
function registerCaptureCommand(api: ExtensionAPI): void {
  disposables.push(
    api.commands.register(
      {
        id: 'task-vault:capture-to-inbox',
        label: 'Capture to inbox',
        mnemonic: 'c',
        description: 'Quick-capture a task to the vault inbox',
      },
      () => openCaptureOverlay(api)
    )
  )
}

/** The command a Home item runs to open the vault, on a task or on the weekly review. */
function registerOpenCommand(api: ExtensionAPI): void {
  disposables.push(
    api.commands.register(
      {
        id: OPEN_COMMAND,
        label: 'Open Task Vault',
        description: 'Open the vault on a task or on the weekly review',
        args: z.object({
          taskId: z.string().optional(),
          view: z.enum(['daily', 'review']).optional(),
        }),
      },
      (_context, args) => openInVault(api, args ?? {})
    )
  )
}

function weeklyReviewDay(api: ExtensionAPI): number {
  return parseInt(api.settings.get<string>('terminator.task-vault.weeklyReviewDay') ?? '0', 10)
}

/** Publishes to Home now and whenever the vault says its index changed. */
function startHome(api: ExtensionAPI, db: ExtensionDB): HomePublisher {
  const home = startHomePublisher(api, db)
  disposables.push(home)
  bindBroadcast((channel, data) => {
    api.window.broadcast(channel, data)
    if (channel === 'task-vault:push:index-updated') home.schedule()
  })
  return home
}

/** Activates task-vault; returns what other extensions may use, through extensionDependencies (ADR 094). */
export async function activate(api: ExtensionAPI): Promise<TaskVaultAPI> {
  _api = api
  const db: ExtensionDB = api.db
  const home = startHome(api, db)
  disposables.push(
    api.settings.register({
      label: 'Task Vault',
      properties: { ...BASE_SETTINGS, ...buildNotificationSettingProperties() },
    })
  )
  const ownIpc = createIpcRegistrar(api, { onError: errorResult })
  disposables.push({ dispose: ownIpc.cleanup })
  registerDbActions(ownIpc, db)
  registerFeatureIpc(api, db)
  await initializeSchema(api, db)
  home.schedule()
  registerNavigation(ownIpc, api)
  addCalendarMenuItem(api)
  scheduleWeeklyReviewNudge(api)
  registerPendingCapture(ownIpc)
  await registerCaptureShortcut(api)
  registerCaptureCommand(api)
  registerOpenCommand(api)
  return {
    open: (destination) => openInVault(api, destination),
    openCapture: () => openCaptureOverlay(api),
  }
}

let reviewNudgeTimer: ReturnType<typeof setTimeout> | null = null

function clearReviewNudgeTimer(): void {
  if (reviewNudgeTimer === null) return
  clearTimeout(reviewNudgeTimer)
  reviewNudgeTimer = null
}

function nudgeWeeklyReview(api: ExtensionAPI): void {
  // A notification rather than a toast: a toast is transient and has nothing
  // to click, so "open Task Vault to start" was an instruction to go and do
  // the navigation yourself. This one is the link.
  api.notifications.createNotification({
    type: 'info',
    title: 'Weekly review is ready',
    key: 'weeklyReviewReady',
    onClick: () => openInVault(api, { view: 'review' }),
  })
}

/** Checks daily whether today is the review day; the setting is read at each check, so a change applies. */
function scheduleWeeklyReviewNudge(api: ExtensionAPI): void {
  clearReviewNudgeTimer()
  const now = zonedNow()
  // Temporal counts Sunday as 7; the setting counts it as 0.
  if (now.dayOfWeek % 7 === weeklyReviewDay(api)) nudgeWeeklyReview(api)
  // The same time tomorrow, not 24 hours on: when the clocks change, 24 hours can step over a date.
  const untilTomorrow = now.add({ days: 1 }).epochMilliseconds - now.epochMilliseconds
  reviewNudgeTimer = setTimeout(() => scheduleWeeklyReviewNudge(api), untilTomorrow)
}

function openCaptureOverlay(api: ExtensionAPI): void {
  // Bring the app forward and tell any already-running extension view immediately.
  api.window.raise()
  api.window.broadcast('task-vault:push:open-capture', undefined)
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
  clearPendingCaptureTimer()
  clearReviewNudgeTimer()
  for (const d of disposables) {
    d.dispose()
  }
  disposables.length = 0
  await _stopScheduler?.()
  _stopScheduler = null
}
