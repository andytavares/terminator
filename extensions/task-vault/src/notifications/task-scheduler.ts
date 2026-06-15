import { BrowserWindow, Notification } from 'electron'
import { getDb } from '../vault/db.js'
import type { ExtensionAPI, Disposable } from '../../../../src/main/extensions/api.js'

let _tick: (() => void) | null = null

export function setSchedulerTick(fn: () => void): void {
  _tick = fn
}

export function triggerSchedulerTick(): void {
  _tick?.()
}

const UNIT_MS: Record<string, number> = {
  min: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
}

function parseIntervalMs(value: string): number {
  const m = value.match(/^(\d+)-(min|hour|day|week|month)s?$/)
  if (!m) return Infinity
  const unit = UNIT_MS[m[2]]
  return unit !== undefined ? parseInt(m[1]) * unit : Infinity
}

function getTargetTimestamp(value: string, blockedAt: number): number {
  const intervalMs = parseIntervalMs(value)
  if (intervalMs !== Infinity) return blockedAt + intervalMs
  // Custom ISO datetime — absolute target
  const ts = new Date(value).getTime()
  return isNaN(ts) ? Infinity : ts
}

export function broadcast(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  })
}

export function startTaskScheduler(api: ExtensionAPI): { dispose: () => void; tick: () => void } {
  // In-memory dedup set (fast path within a session)
  const notifiedDueIds = new Set<string>()
  // Notification disposables so we can auto-dismiss when tasks resolve
  const dueTaskNotifs = new Map<string, Disposable>()
  const lastNotifiedBlocked = new Map<string, number>()
  const blockedTaskNotifs = new Map<string, Disposable>()
  let lastDay = new Date().toDateString()
  let isStartup = true

  function tick(): void {
    try {
      const db = getDb()
      const now = Date.now()
      const nowDate = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const today = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`

      // Reset due-task dedup at midnight
      const currentDay = new Date().toDateString()
      if (currentDay !== lastDay) {
        notifiedDueIds.clear()
        lastDay = currentDay
      }

      // ── Auto-dismiss due notifications for tasks no longer open ──────────────
      if (dueTaskNotifs.size > 0) {
        const trackedIds = Array.from(dueTaskNotifs.keys())
        const placeholders = trackedIds.map(() => '?').join(',')
        type StatusRow = { id: string }
        const resolved = db
          .prepare(
            `SELECT id FROM tasks WHERE id IN (${placeholders}) AND status IN ('done','cancelled','migrated')`
          )
          .all(...trackedIds) as StatusRow[]
        for (const row of resolved) {
          dueTaskNotifs.get(row.id)?.dispose()
          dueTaskNotifs.delete(row.id)
          notifiedDueIds.delete(row.id)
        }
      }

      // ── Auto-dismiss blocked notifications for tasks no longer blocked ───────
      if (blockedTaskNotifs.size > 0) {
        const trackedIds = Array.from(blockedTaskNotifs.keys())
        const placeholders = trackedIds.map(() => '?').join(',')
        type StatusRow = { id: string }
        const resolved = db
          .prepare(`SELECT id FROM tasks WHERE id IN (${placeholders}) AND status != 'blocked'`)
          .all(...trackedIds) as StatusRow[]
        for (const row of resolved) {
          blockedTaskNotifs.get(row.id)?.dispose()
          blockedTaskNotifs.delete(row.id)
        }
      }

      // ── Due tasks (gated by configured alert time) ───────────────
      const globalAlertTimeSetting =
        api.settings.get<string>('terminator.task-vault.dueDateAlertTime') ?? '09:00'
      const [globalAlertHourStr = '9', globalAlertMinStr = '0'] = globalAlertTimeSetting.split(':')
      const globalAlertTotalMinutes =
        parseInt(globalAlertHourStr) * 60 + parseInt(globalAlertMinStr)
      const currentTotalMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()

      type DueRow = {
        id: string
        text: string
        due_date: string
        source_ref: string | null
        project_id: string | null
        context: string | null
        area_id: string | null
        recurrence_notify_at: string | null
        metadata: string
      }
      const dueTasks = db
        .prepare(
          `SELECT id, text, due_date, source_ref, project_id, context, area_id,
                  recurrence_notify_at, metadata FROM tasks
           WHERE status='open' AND due_date IS NOT NULL AND due_date <= ? AND parent_id IS NULL`
        )
        .all(today) as DueRow[]

      for (const task of dueTasks) {
        // In-session dedup (resets on restart — intentional; startup fires notifications once)
        if (notifiedDueIds.has(task.id)) continue

        const isOverdue = task.due_date < today

        // Use per-task recurrence_notify_at column if set, otherwise fall back to global alert time
        let taskAlertMinutes = globalAlertTotalMinutes
        if (task.recurrence_notify_at) {
          const [h = '9', m = '0'] = task.recurrence_notify_at.split(':')
          taskAlertMinutes = parseInt(h) * 60 + parseInt(m)
        }

        // On startup: fire for all due tasks regardless of alert time.
        // On regular ticks: past-due tasks always fire; today's tasks respect the alert time.
        if (!isStartup && !isOverdue && currentTotalMinutes < taskAlertMinutes) continue

        notifiedDueIds.add(task.id)
        const taskId = task.id
        // Navigate to the log that contains the task (source_ref), not the due date
        const taskDate = task.source_ref ?? null
        const notifTitle = isOverdue ? `Overdue: ${task.text}` : `Due today: ${task.text}`
        // OS system notification (clickable — navigates to the task)
        if (Notification.isSupported()) {
          const osNotif = new Notification({ title: notifTitle, silent: false })
          osNotif.on('click', () =>
            broadcast('task-vault:navigate-task', { taskId, date: taskDate })
          )
          osNotif.show()
        }
        const notif = api.notifications.createNotification({
          type: isOverdue ? 'error' : 'warning',
          title: notifTitle,
          targets: ['center', 'toast'],
          actions: [
            {
              id: 'open',
              label: 'Open Vault',
              handler: () => broadcast('task-vault:navigate-task', { taskId, date: taskDate }),
            },
          ],
        })
        dueTaskNotifs.set(task.id, notif)
      }

      // ── Blocked tasks with check interval ────────────────────────
      type BlockedRow = {
        id: string
        text: string
        updated_at: string
        metadata: string
        source_ref: string | null
      }
      const blockedTasks = db
        .prepare(
          `SELECT id, text, updated_at, metadata, source_ref FROM tasks
           WHERE status='blocked' AND metadata IS NOT NULL AND parent_id IS NULL`
        )
        .all() as BlockedRow[]

      for (const task of blockedTasks) {
        let meta: Record<string, string> = {}
        try {
          meta = JSON.parse(task.metadata) as Record<string, string>
        } catch {
          continue
        }
        const interval = meta.blocked_check_interval
        if (!interval) continue

        const blockedAt = new Date(task.updated_at).getTime()
        const targetTs = getTargetTimestamp(interval, blockedAt)
        if (!isFinite(targetTs) || now < targetTs) continue

        const isCustom = parseIntervalMs(interval) === Infinity
        const lastNotified = lastNotifiedBlocked.get(task.id) ?? blockedAt

        if (isCustom) {
          // Fire once when target passes
          if (lastNotified >= targetTs) continue
        } else {
          // Re-fire each interval after last notification
          const intervalMs = parseIntervalMs(interval)
          if (now - lastNotified < intervalMs) continue
        }

        lastNotifiedBlocked.set(task.id, now)
        const taskId = task.id
        const taskDate = task.source_ref ?? null

        // Dismiss any existing notification for this blocked task before creating a new one
        blockedTaskNotifs.get(task.id)?.dispose()

        const blockedTitle = `Check in: ${task.text}`
        // OS system notification (clickable — navigates to the task)
        if (Notification.isSupported()) {
          const osNotif = new Notification({
            title: blockedTitle,
            body: meta.blocked_reason ?? '',
            silent: false,
          })
          osNotif.on('click', () =>
            broadcast('task-vault:navigate-task', { taskId, date: taskDate })
          )
          osNotif.show()
        }
        const notif = api.notifications.createNotification({
          type: 'info',
          title: blockedTitle,
          message: meta.blocked_reason ?? undefined,
          targets: ['center', 'toast'],
          actions: [
            {
              id: 'open',
              label: 'Open Vault',
              handler: () => broadcast('task-vault:navigate-task', { taskId, date: taskDate }),
            },
          ],
        })
        blockedTaskNotifs.set(task.id, notif)
      }
    } catch {
      // DB may not be initialized yet — retry next tick
    }
  }

  tick()
  isStartup = false
  const intervalId = setInterval(tick, 15_000)
  return {
    dispose: () => clearInterval(intervalId),
    tick,
  }
}
