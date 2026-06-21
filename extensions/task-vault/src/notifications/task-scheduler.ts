import { BrowserWindow, Notification } from 'electron'
import type { ExtensionAPI, ExtensionDB, Disposable } from '../../../../src/main/extensions/api.js'

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
  const ts = new Date(value).getTime()
  return isNaN(ts) ? Infinity : ts
}

export function broadcast(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  })
}

export function startTaskScheduler(
  api: ExtensionAPI,
  db: ExtensionDB
): {
  dispose: () => void
  tick: () => void
  tickAsync: () => Promise<void>
  startupPromise: Promise<void>
} {
  const notifiedDueIds = new Set<string>()
  const dueTaskNotifs = new Map<string, Disposable>()
  const lastNotifiedBlocked = new Map<string, number>()
  const blockedTaskNotifs = new Map<string, Disposable>()
  let lastDay = new Date().toDateString()
  let isStartup = true

  async function tickAsync(): Promise<void> {
    const wasStartup = isStartup
    try {
      const now = Date.now()
      const nowDate = new Date()
      const pad = (n: number): string => String(n).padStart(2, '0')
      const today = `${nowDate.getFullYear()}-${pad(nowDate.getMonth() + 1)}-${pad(nowDate.getDate())}`

      const currentDay = new Date().toDateString()
      if (currentDay !== lastDay) {
        notifiedDueIds.clear()
        lastDay = currentDay
      }

      if (dueTaskNotifs.size > 0) {
        const trackedIds = Array.from(dueTaskNotifs.keys())
        const placeholders = trackedIds.map(() => '?').join(',')
        type StatusRow = { id: string }
        const resolved = await db.query<StatusRow>(
          `SELECT id FROM tasks WHERE id IN (${placeholders}) AND status IN ('done','cancelled','migrated')`,
          trackedIds
        )
        for (const row of resolved) {
          dueTaskNotifs.get(row.id)?.dispose()
          dueTaskNotifs.delete(row.id)
          notifiedDueIds.delete(row.id)
        }
      }

      if (blockedTaskNotifs.size > 0) {
        const trackedIds = Array.from(blockedTaskNotifs.keys())
        const placeholders = trackedIds.map(() => '?').join(',')
        type StatusRow = { id: string }
        const resolved = await db.query<StatusRow>(
          `SELECT id FROM tasks WHERE id IN (${placeholders}) AND status != 'blocked'`,
          trackedIds
        )
        for (const row of resolved) {
          blockedTaskNotifs.get(row.id)?.dispose()
          blockedTaskNotifs.delete(row.id)
        }
      }

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
      const dueTasks = await db.query<DueRow>(
        `SELECT id, text, due_date, source_ref, project_id, context, area_id,
                recurrence_notify_at, metadata FROM tasks
         WHERE status='open' AND due_date IS NOT NULL AND due_date <= ? AND parent_id IS NULL`,
        [today]
      )

      for (const task of dueTasks) {
        if (notifiedDueIds.has(task.id)) continue

        const isOverdue = task.due_date < today

        let taskAlertMinutes = globalAlertTotalMinutes
        if (task.recurrence_notify_at) {
          const [h = '9', m = '0'] = task.recurrence_notify_at.split(':')
          taskAlertMinutes = parseInt(h) * 60 + parseInt(m)
        }

        if (!wasStartup && !isOverdue && currentTotalMinutes < taskAlertMinutes) continue

        notifiedDueIds.add(task.id)
        const taskId = task.id
        const taskDate = task.source_ref ?? null
        const notifTitle = isOverdue ? `Overdue: ${task.text}` : `Due today: ${task.text}`
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

      type BlockedRow = {
        id: string
        text: string
        updated_at: string
        metadata: string
        source_ref: string | null
      }
      const blockedTasks = await db.query<BlockedRow>(
        `SELECT id, text, updated_at, metadata, source_ref FROM tasks
         WHERE status='blocked' AND metadata IS NOT NULL AND parent_id IS NULL`
      )

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
          if (lastNotified >= targetTs) continue
        } else {
          const intervalMs = parseIntervalMs(interval)
          if (now - lastNotified < intervalMs) continue
        }

        lastNotifiedBlocked.set(task.id, now)
        const taskId = task.id
        const taskDate = task.source_ref ?? null

        blockedTaskNotifs.get(task.id)?.dispose()

        const blockedTitle = `Check in: ${task.text}`
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
      // ignore errors during tick
    }
  }

  function tick(): void {
    tickAsync().catch(() => {})
  }

  const startupPromise = tickAsync().catch(() => {})
  isStartup = false
  const intervalId = setInterval(tick, 15_000)
  return {
    dispose: () => clearInterval(intervalId),
    tick,
    tickAsync,
    startupPromise,
  }
}
