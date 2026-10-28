import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExtensionAPI, ExtensionDB } from '@terminator/extension-sdk'
import { isPending, unfinishedWork } from '../../../../tests/support/pending'
import { partialFake } from '../../../../tests/support/fakes'
import { createVaultDb, seedTask, selectTaskRow } from '../support/vault-db'
import {
  setSchedulerTick,
  triggerSchedulerTick,
  startTaskScheduler,
  broadcast,
  bindBroadcast,
} from '../../src/notifications/task-scheduler.js'

// The scheduler runs against a real vault database, so its WHERE clauses run for real.

/** An API whose settings answer `alertTime` for every key. */
function makeApi(alertTime?: string) {
  return partialFake<ExtensionAPI>({
    settings: partialFake<ExtensionAPI['settings']>({ get: <T>() => alertTime as T | undefined }),
    notifications: partialFake<ExtensionAPI['notifications']>({
      createNotification: vi.fn(() => ({ dispose: vi.fn() })),
    }),
    // Clicking a notification navigates, and navigating is these two.
    window: partialFake<ExtensionAPI['window']>({ focusSelf: vi.fn(), broadcast: vi.fn() }),
  })
}

const created = (api: ExtensionAPI) => vi.mocked(api.notifications.createNotification).mock.calls
const ofType = (api: ExtensionAPI, type: string) =>
  created(api).filter(([notification]) => notification.type === type)

type Created = Parameters<ExtensionAPI['notifications']['createNotification']>[0]
const firstNotification = (api: ExtensionAPI) => created(api)[0][0] as Created

/** A task blocked at `at`, to be checked in every `interval`. */
function seedBlocked(db: ExtensionDB, blocked: { at: string; interval: string }) {
  return seedTask(db, {
    id: 'b1',
    text: 'Blocked task',
    status: 'blocked',
    updatedAt: new Date(blocked.at).toISOString(),
    metadata: JSON.stringify({ blocked_check_interval: blocked.interval }),
  })
}

function trackDisposals(api: ExtensionAPI) {
  const dispose = vi.fn()
  vi.mocked(api.notifications.createNotification).mockReturnValue({ dispose })
  return dispose
}

let db: ExtensionDB

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  db = await createVaultDb()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

/** Runs the startup pass, then `ticks` more passes, and stops the scheduler. */
async function runScheduler(api: ExtensionAPI, ticks = 0): Promise<void> {
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise
  for (let i = 0; i < ticks; i++) await scheduler.tickAsync()
  await scheduler.dispose()
}

describe('setSchedulerTick / triggerSchedulerTick', () => {
  it('triggerSchedulerTick calls the registered tick function', () => {
    const fn = vi.fn()
    setSchedulerTick(fn)
    triggerSchedulerTick()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it(
    'triggerSchedulerTick is a no-op before setSchedulerTick is called',
    triggerschedulertickIsANoOpBeforeSetschedulertick
  )
})

describe('startTaskScheduler — stopping', () => {
  it('runs an interval until it is disposed', runsAnIntervalUntilItIsDisposed)

  it('settles once a tick in flight has finished', settlesOnceATickInFlightHas)
})

describe('startTaskScheduler — due tasks', () => {
  it(
    'warns about a task due today once the alert time has passed, and only once',
    warnsAboutATaskDueTodayOnce
  )

  it('warns on startup even before the alert time', warnsOnStartupEvenBeforeTheAlert)

  it('stays quiet on a later tick before the alert time', staysQuietOnALaterTickBefore)

  it('reports an overdue task as an error', reportsAnOverdueTaskAsAnError)

  it(
    'leaves out tasks that are not open, not yet due, subtasks or without a due date',
    leavesOutTasksThatAreNotOpen
  )

  it(
    'does not write anything into the task: the dedup is in memory',
    doesNotWriteAnythingIntoTheTask
  )

  it('announces a task again on the next day', announcesATaskAgainOnTheNext)

  it('swallows a database failure and raises nothing', swallowsADatabaseFailureAndRaisesNothing)
})

describe("startTaskScheduler — a task's own notify time", () => {
  it('warns once the time of day in recurrence_notify_at is reached', warnsOnceTheTimeOfDayIn)

  it(
    'waits for recurrence_notify_at on a later tick, whatever the global alert time says',
    waitsForRecurrenceNotifyAtOnA
  )

  it(
    'uses the global alert time when the task has none, and inserts no task row',
    usesTheGlobalAlertTimeWhenThe
  )
})

describe('clicking a notification', () => {
  it('takes you to the due task, through the window and the vault tab', takesYouToTheDueTaskThrough)

  it('takes you to the blocked task, on the day it was blocked', takesYouToTheBlockedTaskOn)
})

describe('startTaskScheduler — blocked tasks', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-05-26T10:00:00')))

  it(
    'checks in once the interval has elapsed, with the reason as the message',
    checksInOnceTheIntervalHasElapsed
  )

  it('waits while the interval has not elapsed', waitsWhileTheIntervalHasNotElapsed)

  it(
    'skips a task with unreadable metadata or no check interval',
    skipsATaskWithUnreadableMetadataOr
  )

  it('checks in on a custom date that has passed', checksInOnACustomDateThat)

  it(
    'raises nothing for a blocked time that is not a date, and still checks the others',
    raisesNothingForABlockedTimeThat
  )
})

describe('startTaskScheduler — dismissing', () => {
  beforeEach(() => vi.setSystemTime(new Date('2026-05-26T10:00:00')))

  it(
    'dismisses a due notification when the task is done, and leaves it when it is open',
    dismissesADueNotificationWhenTheTask
  )

  it(
    'dismisses a blocked notification when the task is unblocked',
    dismissesABlockedNotificationWhenTheTask
  )
})

/** How many check-ins one startup pass raises for a task blocked at `blockedAt`, looked at `now`. */
async function checkInsRaised(interval: string, blockedAt: string, now: string): Promise<number> {
  vi.setSystemTime(new Date(now))
  const api = makeApi('09:00')
  const freshDb = await createVaultDb()
  await seedBlocked(freshDb, { at: blockedAt, interval: interval })
  const scheduler = startTaskScheduler(api, freshDb)
  await scheduler.startupPromise
  await scheduler.dispose()
  return created(api).length
}

describe('a blocked task checked in after days, weeks or months', () => {
  it(
    'comes due at the same time of day when the clocks went forward in between',
    comesDueAtTheSameTimeOf
  )

  it(
    'comes due at the same time of day when the clocks went back in between',
    comesDueAtTheSameTimeOfX
  )

  it('counts a month as the calendar counts it, not as 30 days', countsAMonthAsTheCalendarCounts)

  it('still counts hours as hours across a clock change', stillCountsHoursAsHoursAcrossA)
})

describe('telling every window something changed', () => {
  // Still the vault's push channel: the IPC handlers announce index moves on it. The backend
  // runs in the extension host (ADR 094), which has no windows, so the window broadcast bound at
  // activation is the only way out.
  it('sends through the broadcast activate bound', () => {
    const send = vi.fn()
    bindBroadcast(send)
    broadcast('task-vault:push:index-updated', { a: 1 })
    expect(send).toHaveBeenCalledWith('task-vault:push:index-updated', { a: 1 })
  })
})

describe('running a pass on demand', () => {
  it('exposes a tick, so a write can refresh what is due without waiting', exposesATickSoAWriteCan)
})

async function triggerschedulertickIsANoOpBeforeSetschedulertick() {
  vi.resetModules()
  const fresh = await import('../../src/notifications/task-scheduler.js')
  expect(() => fresh.triggerSchedulerTick()).not.toThrow()
}

async function runsAnIntervalUntilItIsDisposed() {
  const scheduler = startTaskScheduler(makeApi(), db)
  await scheduler.startupPromise
  expect(vi.getTimerCount()).toBe(1)
  await scheduler.dispose()
  expect(vi.getTimerCount()).toBe(0)
}

async function settlesOnceATickInFlightHas() {
  const query = unfinishedWork()
  let queryAnswered = false
  const slowDb: ExtensionDB = {
    ...db,
    query: async (sql, params) => {
      await query.done
      queryAnswered = true
      return db.query(sql, params)
    },
  }
  const scheduler = startTaskScheduler(makeApi(), slowDb)

  const disposed = scheduler.dispose()
  expect(await isPending(disposed)).toBe(true)
  query.finish()
  await disposed

  expect(queryAnswered).toBe(true)
}

async function warnsAboutATaskDueTodayOnce() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, { id: 't1', text: 'Finish report', dueDate: '2026-05-26' })

  await runScheduler(api, 1)

  expect(created(api)).toEqual([
    [expect.objectContaining({ type: 'warning', title: 'Due today: Finish report' })],
  ])
}

async function warnsOnStartupEvenBeforeTheAlert() {
  vi.setSystemTime(new Date('2026-05-26T07:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, { id: 't1', text: 'Early task', dueDate: '2026-05-26' })

  await runScheduler(api)

  expect(ofType(api, 'warning')).toHaveLength(1)
}

async function staysQuietOnALaterTickBefore() {
  vi.setSystemTime(new Date('2026-05-26T08:00:00'))
  const api = makeApi('09:00')
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise
  await seedTask(db, { id: 't2', text: 'New task', dueDate: '2026-05-26' })
  await scheduler.tickAsync()
  await scheduler.dispose()

  expect(created(api)).toEqual([])
}

async function reportsAnOverdueTaskAsAnError() {
  vi.setSystemTime(new Date('2026-05-26T07:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, { id: 'od1', text: 'Overdue task', dueDate: '2026-05-25' })

  await runScheduler(api)

  expect(created(api)).toEqual([
    [expect.objectContaining({ type: 'error', title: 'Overdue: Overdue task' })],
  ])
}

async function leavesOutTasksThatAreNotOpen() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, { id: 'parent', text: 'Parent' })
  await seedTask(db, { id: 'done', status: 'done', dueDate: '2026-05-26' })
  await seedTask(db, { id: 'later', dueDate: '2026-05-27' })
  await seedTask(db, { id: 'none' })
  await seedTask(db, { id: 'sub', parentId: 'parent', dueDate: '2026-05-26' })

  await runScheduler(api)

  expect(created(api)).toEqual([])
}

async function doesNotWriteAnythingIntoTheTask() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  await seedTask(db, { id: 'persist', dueDate: '2026-05-26' })
  const before = await selectTaskRow(db, 'persist')

  await runScheduler(makeApi('09:00'), 1)

  expect(await selectTaskRow(db, 'persist')).toEqual(before)
}

async function announcesATaskAgainOnTheNext() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, { id: 't-mid', text: 'Midnight task', dueDate: '2026-05-26' })
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise
  vi.setSystemTime(new Date('2026-05-27T10:00:00'))
  await scheduler.tickAsync()
  await scheduler.dispose()

  expect(created(api).map(([notification]) => notification.type)).toEqual(['warning', 'error'])
}

async function swallowsADatabaseFailureAndRaisesNothing() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, { id: 't1', dueDate: '2026-05-26' })
  const failing: ExtensionDB = { ...db, query: () => Promise.reject(new Error('DB not ready')) }

  const scheduler = startTaskScheduler(api, failing)
  await scheduler.startupPromise
  await scheduler.dispose()

  expect(created(api)).toEqual([])
}

async function warnsOnceTheTimeOfDayIn() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, {
    id: 'r1',
    text: 'Recurring task',
    dueDate: '2026-05-26',
    recurrenceNotifyAt: '10:00',
  })
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise
  await scheduler.tickAsync()
  await scheduler.dispose()

  expect(ofType(api, 'warning')).toHaveLength(1)
}

async function waitsForRecurrenceNotifyAtOnA() {
  vi.setSystemTime(new Date('2026-05-26T08:30:00'))
  const api = makeApi('07:00')
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise
  await seedTask(db, {
    id: 'r1',
    text: 'Daily standup',
    dueDate: '2026-05-26',
    recurrenceRule: 'daily',
    recurrenceNotifyAt: '10:00',
  })
  await scheduler.tickAsync()
  await scheduler.dispose()

  expect(created(api)).toEqual([])
}

async function usesTheGlobalAlertTimeWhenThe() {
  vi.setSystemTime(new Date('2026-05-26T09:30:00'))
  const api = makeApi('09:00')
  await seedTask(db, {
    id: 'rec-1',
    text: 'Daily standup',
    dueDate: '2026-05-26',
    recurrenceRule: 'daily',
  })
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise
  await scheduler.tickAsync()
  await scheduler.dispose()

  expect(ofType(api, 'warning')).toHaveLength(1)
  expect(await db.query(`SELECT id FROM tasks`)).toEqual([{ id: 'rec-1' }])
}

async function takesYouToTheDueTaskThrough() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, { id: 't-action', dueDate: '2026-05-26', sourceRef: '2026-05-26' })

  await runScheduler(api)
  const notification = firstNotification(api)

  expect(notification.actions).toBeUndefined()
  notification.onClick?.()
  expect(api.window.focusSelf).toHaveBeenCalled()
  expect(api.window.broadcast).toHaveBeenCalledWith(
    'extension:activate-global-tab',
    'terminator.task-vault'
  )
  expect(api.window.broadcast).toHaveBeenCalledWith(
    'task-vault:navigate',
    expect.objectContaining({ taskId: 't-action' })
  )
}

async function takesYouToTheBlockedTaskOn() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  const api = makeApi('09:00')
  await seedTask(db, {
    id: 'b-inapp',
    status: 'blocked',
    sourceRef: '2026-05-21',
    updatedAt: new Date('2026-05-26T08:00:00').toISOString(),
    metadata: JSON.stringify({ blocked_check_interval: '1-hour' }),
  })

  await runScheduler(api)
  firstNotification(api).onClick?.()

  expect(api.window.broadcast).toHaveBeenCalledWith(
    'task-vault:navigate',
    expect.objectContaining({ taskId: 'b-inapp', date: '2026-05-21' })
  )
}

async function checksInOnceTheIntervalHasElapsed() {
  const api = makeApi('09:00')
  await seedTask(db, {
    id: 'b1',
    text: 'Blocked task',
    status: 'blocked',
    updatedAt: new Date('2026-05-26T08:00:00').toISOString(),
    metadata: JSON.stringify({ blocked_check_interval: '1-hour', blocked_reason: 'waiting' }),
  })

  await runScheduler(api)

  expect(created(api)).toEqual([
    [
      expect.objectContaining({
        type: 'info',
        title: 'Check in: Blocked task',
        message: 'waiting',
      }),
    ],
  ])
}

async function waitsWhileTheIntervalHasNotElapsed() {
  const api = makeApi('09:00')
  await seedBlocked(db, { at: '2026-05-26T09:30:00', interval: '1-hour' })

  await runScheduler(api)

  expect(created(api)).toEqual([])
}

async function skipsATaskWithUnreadableMetadataOr() {
  const api = makeApi('09:00')
  await seedTask(db, { id: 'bad', status: 'blocked', metadata: 'NOT_JSON' })
  await seedTask(db, {
    id: 'none',
    status: 'blocked',
    metadata: JSON.stringify({ blocked_reason: 'waiting' }),
  })

  await runScheduler(api)

  expect(created(api)).toEqual([])
}

async function checksInOnACustomDateThat() {
  const api = makeApi('09:00')
  await seedBlocked(db, {
    at: '2026-05-26T08:00:00',
    interval: new Date('2026-05-26T09:59:00').toISOString(),
  })

  await runScheduler(api)

  expect(ofType(api, 'info')).toHaveLength(1)
}

async function raisesNothingForABlockedTimeThat() {
  const api = makeApi('09:00')
  await seedTask(db, {
    id: 'yesterday',
    status: 'blocked',
    updatedAt: 'yesterday',
    metadata: JSON.stringify({ blocked_check_interval: '1-hour' }),
  })
  await seedBlocked(db, { at: '2026-05-26T08:00:00', interval: '1-hour' })

  await runScheduler(api)

  expect(created(api)).toHaveLength(1)
}

async function dismissesADueNotificationWhenTheTask() {
  const api = makeApi('09:00')
  const dispose = trackDisposals(api)
  await seedTask(db, { id: 'done-task', dueDate: '2026-05-26' })
  await seedTask(db, { id: 'open-task', dueDate: '2026-05-26' })
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise

  await db.run(`UPDATE tasks SET status = 'done' WHERE id = 'done-task'`)
  await scheduler.tickAsync()
  await scheduler.dispose()

  expect(dispose).toHaveBeenCalledTimes(1)
}

async function dismissesABlockedNotificationWhenTheTask() {
  const api = makeApi('09:00')
  const dispose = trackDisposals(api)
  await seedBlocked(db, { at: '2026-05-26T08:00:00', interval: '1-hour' })
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise

  await db.run(`UPDATE tasks SET status = 'open' WHERE id = 'b1'`)
  await scheduler.tickAsync()
  await scheduler.dispose()

  expect(dispose).toHaveBeenCalledTimes(1)
}

async function comesDueAtTheSameTimeOf() {
  vi.stubEnv('TZ', 'America/New_York')
  // Blocked Saturday 10:00; the clocks go forward on Sunday at 02:00.
  expect(await checkInsRaised('1-day', '2026-03-07T10:00:00', '2026-03-08T09:59:00')).toBe(0)
  expect(await checkInsRaised('1-day', '2026-03-07T10:00:00', '2026-03-08T10:01:00')).toBe(1)
}

async function comesDueAtTheSameTimeOfX() {
  vi.stubEnv('TZ', 'America/New_York')
  // Blocked Saturday 10:00; the clocks go back on Sunday at 02:00.
  expect(await checkInsRaised('1-week', '2026-10-31T10:00:00', '2026-11-07T09:30:00')).toBe(0)
  expect(await checkInsRaised('1-week', '2026-10-31T10:00:00', '2026-11-07T10:01:00')).toBe(1)
}

async function countsAMonthAsTheCalendarCounts() {
  expect(await checkInsRaised('1-month', '2026-02-10T12:00:00', '2026-03-10T11:59:00')).toBe(0)
  expect(await checkInsRaised('1-month', '2026-02-10T12:00:00', '2026-03-10T12:01:00')).toBe(1)
  expect(await checkInsRaised('1-month', '2026-07-10T12:00:00', '2026-08-09T12:01:00')).toBe(0)
}

async function stillCountsHoursAsHoursAcrossA() {
  vi.stubEnv('TZ', 'America/New_York')
  // 01:30 EST plus four hours is 06:30 EDT: the hour from 02:00 to 03:00 does not exist.
  expect(await checkInsRaised('4-hour', '2026-03-08T01:30:00', '2026-03-08T06:29:00')).toBe(0)
  expect(await checkInsRaised('4-hour', '2026-03-08T01:30:00', '2026-03-08T06:31:00')).toBe(1)
}

async function exposesATickSoAWriteCan() {
  vi.setSystemTime(new Date('2026-05-26T10:00:00'))
  const api = makeApi('09:00')
  const scheduler = startTaskScheduler(api, db)
  await scheduler.startupPromise
  await seedTask(db, { id: 'late', text: 'Added later', dueDate: '2026-05-26' })

  await scheduler.tickAsync()
  await scheduler.dispose()

  expect(firstNotification(api).title).toBe('Due today: Added later')
}
