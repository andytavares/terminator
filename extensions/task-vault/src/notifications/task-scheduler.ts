import { BrowserWindow } from 'electron'
import { getDb } from '../vault/db.js'
import type { ExtensionAPI } from '../../../../src/main/extensions/api.js'

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

function broadcast(channel: string, data: unknown): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data)
  })
}

export function startTaskScheduler(api: ExtensionAPI): { dispose: () => void; tick: () => void } {
  const notifiedDueIds = new Set<string>()
  const lastNotifiedBlocked = new Map<string, number>()
  let lastDay = new Date().toDateString()

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

      // ── Due tasks (gated by configured alert time) ───────────────
      const alertTimeSetting =
        api.settings.get<string>('terminator.task-vault.dueDateAlertTime') ?? '09:00'
      const [alertHourStr = '9', alertMinStr = '0'] = alertTimeSetting.split(':')
      const alertTotalMinutes = parseInt(alertHourStr) * 60 + parseInt(alertMinStr)
      const currentTotalMinutes = nowDate.getHours() * 60 + nowDate.getMinutes()

      if (currentTotalMinutes >= alertTotalMinutes) {
        type DueRow = { id: string; text: string }
        const dueTasks = db
          .prepare(
            `SELECT id, text FROM tasks
             WHERE status='open' AND due_date IS NOT NULL AND due_date <= ? AND parent_id IS NULL`
          )
          .all(today) as DueRow[]

        for (const task of dueTasks) {
          if (notifiedDueIds.has(task.id)) continue
          notifiedDueIds.add(task.id)
          const taskId = task.id
          api.notifications.createNotification({
            type: 'warning',
            title: `Due today: ${task.text}`,
            actions: [
              {
                id: 'open',
                label: 'Open Vault',
                handler: () => broadcast('task-vault:navigate-task', taskId),
              },
            ],
          })
        }
      }

      // ── Blocked tasks with check interval ────────────────────────
      type BlockedRow = { id: string; text: string; updated_at: string; metadata: string }
      const blockedTasks = db
        .prepare(
          `SELECT id, text, updated_at, metadata FROM tasks
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
        api.notifications.createNotification({
          type: 'info',
          title: `Check in: ${task.text}`,
          message: meta.blocked_reason ?? undefined,
          actions: [
            {
              id: 'open',
              label: 'Open Vault',
              handler: () => broadcast('task-vault:navigate-task', taskId),
            },
          ],
        })
      }
    } catch {
      // DB may not be initialized yet — retry next tick
    }
  }

  tick()
  const intervalId = setInterval(tick, 15_000)
  return { dispose: () => clearInterval(intervalId), tick }
}
