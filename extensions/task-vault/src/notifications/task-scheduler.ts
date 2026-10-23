import type { ExtensionAPI, ExtensionDB, Disposable } from '@terminator/extension-sdk'
import { openInVault } from '../navigation.js'
import { today, zonedAt, zonedNow } from '../vault/clock'

let _tick: (() => void) | null = null

export function setSchedulerTick(fn: () => void): void {
  _tick = fn
}

export function triggerSchedulerTick(): void {
  _tick?.()
}

const DURATION_UNIT = {
  min: 'minutes',
  hour: 'hours',
  day: 'days',
  week: 'weeks',
  month: 'months',
} as const

/** The interval a check-in such as "2-day" names, or null when it is a custom date. */
function parseInterval(value: string): Temporal.Duration | null {
  const match = /^(\d+)-(min|hour|day|week|month)s?$/.exec(value)
  if (!match) return null
  const unit = DURATION_UNIT[match[2] as keyof typeof DURATION_UNIT]
  return Temporal.Duration.from({ [unit]: parseInt(match[1]) })
}

let _broadcast: ((channel: string, data: unknown) => void) | null = null

/** Where `broadcast` sends: `api.window.broadcast`, bound by `activate`. */
export function bindBroadcast(send: (channel: string, data: unknown) => void): void {
  _broadcast = send
}

export function broadcast(channel: string, data: unknown): void {
  _broadcast?.(channel, data)
}

/** What the scheduler remembers between ticks. */
interface SchedulerState {
  notifiedDueIds: Set<string>
  dueTaskNotifs: Map<string, Disposable>
  lastNotifiedBlocked: Map<string, number>
  blockedTaskNotifs: Map<string, Disposable>
  lastDay: string
  isStartup: boolean
}

/** One tick: the scheduler's inputs and the clock it reads once. */
interface Tick {
  api: ExtensionAPI
  db: ExtensionDB
  state: SchedulerState
  now: Temporal.ZonedDateTime
  today: string
  wasStartup: boolean
}

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

type BlockedRow = {
  id: string
  text: string
  updated_at: string
  metadata: string
  source_ref: string | null
}

/** Minutes after midnight of an "HH:MM" time; missing parts default to 9:00. */
function minutesOf(time: string): number {
  const [h = '9', m = '0'] = time.split(':')
  return parseInt(h) * 60 + parseInt(m)
}

/** A new day forgets which tasks were already announced as due. */
function rollDay(state: SchedulerState, today: string): void {
  if (today === state.lastDay) return
  state.notifiedDueIds.clear()
  state.lastDay = today
}

/** Dismisses tracked notifications whose task now matches `condition`; returns their ids. */
async function dismissResolved(
  db: ExtensionDB,
  notifs: Map<string, Disposable>,
  condition: string
): Promise<string[]> {
  if (notifs.size === 0) return []
  const trackedIds = Array.from(notifs.keys())
  const placeholders = trackedIds.map(() => '?').join(',')
  const resolved = await db.query<{ id: string }>(
    `SELECT id FROM tasks WHERE id IN (${placeholders}) AND ${condition}`,
    trackedIds
  )
  for (const row of resolved) {
    notifs.get(row.id)?.dispose()
    notifs.delete(row.id)
  }
  return resolved.map((row) => row.id)
}

async function dismissFinished(tick: Tick): Promise<void> {
  const { db, state } = tick
  const finished = await dismissResolved(
    db,
    state.dueTaskNotifs,
    `status IN ('done','cancelled','migrated')`
  )
  for (const id of finished) state.notifiedDueIds.delete(id)
  await dismissResolved(db, state.blockedTaskNotifs, `status != 'blocked'`)
}

/** Whether a due task should be announced now: overdue, at startup, or past its alert time. */
function dueAlertReached(tick: Tick, task: DueRow): boolean {
  if (tick.wasStartup || task.due_date < tick.today) return true
  const globalAlertTime =
    tick.api.settings.get<string>('terminator.task-vault.dueDateAlertTime') ?? '09:00'
  const alertMinutes = minutesOf(task.recurrence_notify_at ?? globalAlertTime)
  const currentMinutes = tick.now.hour * 60 + tick.now.minute
  return currentMinutes >= alertMinutes
}

function announceDue(tick: Tick, task: DueRow): void {
  const { api, state } = tick
  const isOverdue = task.due_date < tick.today
  const taskId = task.id
  const date = task.source_ref ?? undefined
  state.notifiedDueIds.add(taskId)
  const notif = api.notifications.createNotification({
    type: isOverdue ? 'error' : 'warning',
    title: isOverdue ? `Overdue: ${task.text}` : `Due today: ${task.text}`,
    key: 'dueTaskReminder',
    // Was an "Open Vault" button, which is the wrong shape: opening the
    // task is what clicking the notification should do, not a choice
    // beside it. The row is the link now.
    onClick: () => openInVault(api, { taskId, date }),
  })
  state.dueTaskNotifs.set(taskId, notif)
}

async function notifyDueTasks(tick: Tick): Promise<void> {
  const dueTasks = await tick.db.query<DueRow>(
    `SELECT id, text, due_date, source_ref, project_id, context, area_id,
                recurrence_notify_at, metadata FROM tasks
         WHERE status='open' AND due_date IS NOT NULL AND due_date <= ? AND parent_id IS NULL`,
    [tick.today]
  )
  for (const task of dueTasks) {
    if (tick.state.notifiedDueIds.has(task.id)) continue
    if (dueAlertReached(tick, task)) announceDue(tick, task)
  }
}

function parseMeta(metadata: string): Record<string, string> | null {
  try {
    return JSON.parse(metadata) as Record<string, string>
  } catch {
    return null
  }
}

/** A blocked task is due a check-in a full interval after it was blocked or last checked in, or
 *  once, when its custom date has passed. Days, weeks and months are the calendar's: a day later
 *  is the same time tomorrow, whatever the clocks did. */
function checkInDue(tick: Tick, task: BlockedRow, interval: string): boolean {
  // Date.parse reads what an import or an older version stored; not a date is never due.
  const blockedAt = Date.parse(task.updated_at)
  if (Number.isNaN(blockedAt)) return false
  const lastNotified = tick.state.lastNotifiedBlocked.get(task.id) ?? blockedAt
  const every = parseInterval(interval)
  if (every) return Temporal.ZonedDateTime.compare(tick.now, zonedAt(lastNotified).add(every)) >= 0
  const customDate = Date.parse(interval)
  return customDate <= tick.now.epochMilliseconds && lastNotified < customDate
}

function announceCheckIn(tick: Tick, task: BlockedRow, reason: string | undefined): void {
  const { api, state } = tick
  const taskId = task.id
  const date = task.source_ref ?? undefined
  state.lastNotifiedBlocked.set(taskId, tick.now.epochMilliseconds)
  state.blockedTaskNotifs.get(taskId)?.dispose()
  const notif = api.notifications.createNotification({
    type: 'info',
    title: `Check in: ${task.text}`,
    message: reason,
    key: 'blockedTaskCheckin',
    onClick: () => openInVault(api, { taskId, date }),
  })
  state.blockedTaskNotifs.set(taskId, notif)
}

async function notifyBlockedTasks(tick: Tick): Promise<void> {
  const blockedTasks = await tick.db.query<BlockedRow>(
    `SELECT id, text, updated_at, metadata, source_ref FROM tasks
         WHERE status='blocked' AND metadata IS NOT NULL AND parent_id IS NULL`
  )
  for (const task of blockedTasks) {
    const meta = parseMeta(task.metadata)
    const interval = meta?.blocked_check_interval
    if (!meta || !interval || !checkInDue(tick, task, interval)) continue
    announceCheckIn(tick, task, meta.blocked_reason ?? undefined)
  }
}

async function runTick(api: ExtensionAPI, db: ExtensionDB, state: SchedulerState): Promise<void> {
  const wasStartup = state.isStartup
  try {
    const now = zonedNow()
    const tick = { api, db, state, now, today: now.toPlainDate().toString(), wasStartup }
    rollDay(state, tick.today)
    await dismissFinished(tick)
    await notifyDueTasks(tick)
    await notifyBlockedTasks(tick)
  } catch {
    // ignore errors during tick
  }
}

/** `run` as a tick that is remembered while it is in flight. */
function trackTicks(run: () => Promise<void>) {
  const inFlight = new Set<Promise<void>>()
  const tickAsync = (): Promise<void> => {
    const ticking = run().finally(() => inFlight.delete(ticking))
    inFlight.add(ticking)
    return ticking
  }
  return { tickAsync, inFlight }
}

export function startTaskScheduler(
  api: ExtensionAPI,
  db: ExtensionDB
): {
  /** Stops the interval; settles once the ticks in flight have finished. */
  dispose: () => Promise<void>
  tick: () => void
  tickAsync: () => Promise<void>
  startupPromise: Promise<void>
} {
  const state: SchedulerState = {
    notifiedDueIds: new Set(),
    dueTaskNotifs: new Map(),
    lastNotifiedBlocked: new Map(),
    blockedTaskNotifs: new Map(),
    lastDay: today(),
    isStartup: true,
  }
  const { tickAsync, inFlight } = trackTicks(() => runTick(api, db, state))
  const tick = (): void => {
    tickAsync().catch(() => {})
  }
  const startupPromise = tickAsync().catch(() => {})
  state.isStartup = false
  const intervalId = setInterval(tick, 15_000)
  const dispose = async (): Promise<void> => {
    clearInterval(intervalId)
    await Promise.all(inFlight)
  }
  return { dispose, tick, tickAsync, startupPromise }
}
