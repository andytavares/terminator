import { BrowserWindow } from 'electron'
import { getDb, randomUUID } from '../vault/db.js'
import { computeNextDueDate } from '../vault/recurrence.js'
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
        project_id: string | null
        context: string | null
        area_id: string | null
        metadata: string
      }
      const dueTasks = db
        .prepare(
          `SELECT id, text, due_date, project_id, context, area_id, metadata FROM tasks
           WHERE status='open' AND due_date IS NOT NULL AND due_date <= ? AND parent_id IS NULL`
        )
        .all(today) as DueRow[]

      for (const task of dueTasks) {
        if (notifiedDueIds.has(task.id)) continue

        let meta: Record<string, unknown> = {}
        try {
          meta = JSON.parse(task.metadata || '{}') as Record<string, unknown>
        } catch {
          // ignore malformed metadata
        }

        const isOverdue = task.due_date < today

        // Use per-task recurrence_time if set, otherwise fall back to global alert time
        let taskAlertMinutes = globalAlertTotalMinutes
        const recurrenceTime = meta.recurrence_time as string | undefined
        if (recurrenceTime) {
          const [h = '9', m = '0'] = recurrenceTime.split(':')
          taskAlertMinutes = parseInt(h) * 60 + parseInt(m)
        }

        // On startup: fire for all due tasks regardless of alert time.
        // On regular ticks: past-due tasks always fire; today's tasks respect the alert time.
        if (!isStartup && !isOverdue && currentTotalMinutes < taskAlertMinutes) continue

        notifiedDueIds.add(task.id)
        const taskId = task.id
        const taskDate = task.due_date
        api.notifications.createNotification({
          type: isOverdue ? 'error' : 'warning',
          title: isOverdue ? `Overdue: ${task.text}` : `Due today: ${task.text}`,
          actions: [
            {
              id: 'open',
              label: 'Open Vault',
              handler: () => broadcast('task-vault:navigate-task', { taskId, date: taskDate }),
            },
          ],
        })

        // ── Spawn next occurrence for recurring tasks at notify time ──
        const recurrenceInterval = meta.recurrence_interval as string | undefined
        if (!recurrenceInterval) continue

        // Use recurrence_next_spawned to prevent double-spawn across restarts
        const alreadySpawnedFor = meta.recurrence_next_spawned as string | undefined

        let recurrenceDays: number[] = []
        try {
          if (meta.recurrence_days != null)
            recurrenceDays = JSON.parse(meta.recurrence_days as string) as number[]
        } catch {
          // ignore
        }

        const nextDue = computeNextDueDate(task.due_date, recurrenceInterval, recurrenceDays)
        if (alreadySpawnedFor === nextDue) continue // already spawned this occurrence

        // Check end conditions
        const endType = (meta.recurrence_end_type as string) || 'none'
        const spawnCount = (meta.recurrence_completed_count as number) || 0
        let shouldSpawn = true
        if (endType === 'on_date') {
          const endDate = meta.recurrence_end_date as string | undefined
          if (endDate && nextDue > endDate) shouldSpawn = false
        } else if (endType === 'after_count') {
          const endCount = meta.recurrence_end_count as number | undefined
          if (endCount != null && spawnCount + 1 >= endCount) shouldSpawn = false
        }

        if (!shouldSpawn) continue

        const newId = randomUUID()
        const nowIso = new Date().toISOString()
        const nextMeta: Record<string, unknown> = {
          recurrence_interval: recurrenceInterval,
          recurrence_days: meta.recurrence_days,
          recurrence_time: meta.recurrence_time,
          recurrence_end_type: endType !== 'none' ? endType : undefined,
          recurrence_end_date: meta.recurrence_end_date,
          recurrence_end_count: meta.recurrence_end_count,
          recurrence_completed_count: spawnCount + 1,
        }
        db.prepare(
          `INSERT INTO tasks (id,text,status,project_id,context,area_id,due_date,source,source_ref,metadata,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(
          newId,
          task.text,
          'open',
          task.project_id ?? null,
          task.context ?? null,
          task.area_id ?? null,
          nextDue,
          'daily',
          nextDue,
          JSON.stringify(nextMeta),
          nowIso,
          nowIso
        )
        // Mark the current task so we don't spawn again on the next tick / after restart
        const updatedMeta = { ...meta, recurrence_next_spawned: nextDue }
        db.prepare(`UPDATE tasks SET metadata=?, updated_at=? WHERE id=?`).run(
          JSON.stringify(updatedMeta),
          nowIso,
          task.id
        )
        broadcast('task-vault:recurrence-spawned', { taskId: task.id, nextTaskId: newId, nextDue })
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
  isStartup = false
  const intervalId = setInterval(tick, 15_000)
  return { dispose: () => clearInterval(intervalId), tick }
}
