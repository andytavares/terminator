import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const { mockOsNotif, mockNotifIsSupported } = vi.hoisted(() => {
  const mockOsNotif = { on: vi.fn(), show: vi.fn() }
  const mockNotifIsSupported = vi.fn(() => false)
  return { mockOsNotif, mockNotifIsSupported }
})

const mockSend = vi.fn()
const mockWin = { isDestroyed: vi.fn(() => false), webContents: { send: mockSend } }

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [mockWin]) },
  Notification: Object.assign(
    vi.fn(() => mockOsNotif),
    {
      isSupported: mockNotifIsSupported,
    }
  ),
}))

const mockRun = vi.fn().mockReturnValue({ changes: 1 })
const mockAll = vi.fn(() => [])
// Auto-dismiss queries always return [] by default (no resolved tasks)
const mockAutoDismissAll = vi.fn(() => [])

/**
 * SQL-aware prepare mock: routes auto-dismiss SELECT queries to a separate mock
 * so they don't interfere with the due/blocked task query expectations.
 */
const mockPrepare = vi.fn((sql: string) => {
  if (
    (sql as string).includes("AND status IN ('done','cancelled','migrated')") ||
    (sql as string).includes("AND status != 'blocked'")
  ) {
    return { all: mockAutoDismissAll, run: mockRun }
  }
  return { all: mockAll, run: mockRun }
})
const mockDb = { prepare: mockPrepare }

vi.mock('../../src/vault/db.js', () => ({
  getDb: () => mockDb,
  randomUUID: vi.fn(() => 'sched-uuid'),
}))

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    settings: { get: vi.fn((_key: string) => undefined) },
    notifications: {
      createNotification: vi.fn(() => ({ dispose: vi.fn() })),
    },
    ...overrides,
  } as unknown as import('../../../../src/main/extensions/api.js').ExtensionAPI
}

// ── Re-import after mocks ─────────────────────────────────────────────────────

import {
  setSchedulerTick,
  triggerSchedulerTick,
  startTaskScheduler,
} from '../../src/notifications/task-scheduler.js'

// ── Helpers ───────────────────────────────────────────────────────────────────

function blockedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    text: 'Blocked task',
    updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString(), // 2 hours ago
    metadata: JSON.stringify({ blocked_check_interval: '1-hour' }),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAll.mockReturnValue([])
  mockAutoDismissAll.mockReturnValue([])
  mockRun.mockReturnValue({ changes: 1 })
  mockNotifIsSupported.mockReturnValue(false)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ── setSchedulerTick / triggerSchedulerTick ──────────────────────────────────

describe('setSchedulerTick / triggerSchedulerTick', () => {
  it('triggerSchedulerTick calls the registered tick function', () => {
    const fn = vi.fn()
    setSchedulerTick(fn)
    triggerSchedulerTick()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('triggerSchedulerTick is a no-op before setSchedulerTick is called', () => {
    setSchedulerTick(null as unknown as () => void)
    expect(() => triggerSchedulerTick()).not.toThrow()
  })
})

// ── startTaskScheduler ────────────────────────────────────────────────────────

describe('startTaskScheduler — dispose', () => {
  it('returns dispose function that clears the interval', () => {
    vi.spyOn(global, 'setInterval')
    const api = makeApi()
    const { dispose } = startTaskScheduler(api)
    expect(setInterval).toHaveBeenCalled()
    dispose()
    // No assertion needed beyond not throwing
  })

  it('returns a tick function', () => {
    const api = makeApi()
    const { tick } = startTaskScheduler(api)
    expect(typeof tick).toBe('function')
    startTaskScheduler(api).dispose()
  })
})

describe('startTaskScheduler — due tasks', () => {
  it('fires a warning notification for a due open task past alert time', () => {
    // Set clock so current time is past alert time (09:00)
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({
      settings: { get: vi.fn((_k: string) => '09:00') },
    })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll.mockImplementation((date: string) => {
      // First call = due tasks query, second = blocked tasks query
      if (typeof date === 'string' && date.startsWith('2026')) {
        return [{ id: 't1', text: 'Finish report', due_date: '2026-05-26', metadata: '{}' }]
      }
      return []
    })

    const { tick, dispose } = startTaskScheduler(api)
    // tick is called immediately in startTaskScheduler; call again to confirm dedup
    tick()
    dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: expect.stringContaining('Finish report'),
      })
    )
  })

  it('fires notification on startup even before configured alert time', () => {
    // Startup bypasses the time gate so users see due tasks immediately on launch
    vi.setSystemTime(new Date('2026-05-26T07:00:00'))

    const api = makeApi({
      settings: { get: vi.fn((_k: string) => '09:00') },
    })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll
      .mockReturnValueOnce([
        { id: 't1', text: 'Early task', due_date: '2026-05-26', metadata: '{}' },
      ])
      .mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Early task') })
    )
  })

  it('does not fire notification on a non-startup tick when current time is before alert time', () => {
    vi.setSystemTime(new Date('2026-05-26T08:00:00'))

    const api = makeApi({
      settings: { get: vi.fn((_k: string) => '09:00') },
    })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // Startup tick sees no tasks; subsequent tick sees a new task before alert time
    mockAll
      .mockReturnValueOnce([]) // startup: due tasks empty
      .mockReturnValueOnce([]) // startup: blocked tasks empty
      .mockReturnValueOnce([{ id: 't2', text: 'New task', due_date: '2026-05-26', metadata: '{}' }]) // 2nd tick: due
      .mockReturnValue([])

    const { tick, dispose } = startTaskScheduler(api)
    tick() // non-startup tick — should not fire (before alert time)
    dispose()

    expect(createNotification).not.toHaveBeenCalled()
  })

  it('fires error notification for overdue tasks (past due date)', () => {
    vi.setSystemTime(new Date('2026-05-26T07:00:00'))

    const api = makeApi({
      settings: { get: vi.fn((_k: string) => '09:00') },
    })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // due_date is yesterday — overdue regardless of time
    mockAll
      .mockReturnValueOnce([
        { id: 'od1', text: 'Overdue task', due_date: '2026-05-25', metadata: '{}' },
      ])
      .mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        title: 'Overdue: Overdue task',
      })
    )
  })

  it('deduplicates due task notifications within the same day (in-memory)', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll.mockImplementation(() => [{ id: 'dup', text: 'Dup task', metadata: '{}' }])

    const { tick, dispose } = startTaskScheduler(api)
    tick() // second call
    dispose()

    // Should only fire once despite two ticks (in-memory dedup set)
    const warningCalls = createNotification.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'warning'
    )
    expect(warningCalls).toHaveLength(1)
  })

  it('skips notification for tasks already notified in the same session (in-session dedup)', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // Startup tick notifies; second tick should skip (in-session dedup set)
    const row = {
      id: 'already',
      text: 'Already notified',
      due_date: '2026-05-26',
      recurrence_notify_at: null,
      metadata: '{}',
    }
    mockAll
      .mockReturnValueOnce([row]) // startup tick — notifies and adds to dedup set
      .mockReturnValueOnce([]) // startup blocked
      .mockReturnValueOnce([row]) // second tick — should skip
      .mockReturnValue([])

    const { tick, dispose } = startTaskScheduler(api)
    tick() // second tick
    dispose()

    const warningCalls = createNotification.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'warning'
    )
    expect(warningCalls).toHaveLength(1)
  })

  it('does not write notification_notified_date to task metadata (dedup is in-session only)', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })

    mockAll
      .mockReturnValueOnce([
        {
          id: 'persist',
          text: 'Persist me',
          due_date: '2026-05-26',
          recurrence_notify_at: null,
          metadata: '{}',
        },
      ])
      .mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    // The scheduler must NOT write notification_notified_date to metadata
    const updateCalls = mockRun.mock.calls.filter((args) => {
      const metaArg = args[0] as string
      return typeof metaArg === 'string' && metaArg.includes('notification_notified_date')
    })
    expect(updateCalls).toHaveLength(0)
  })
})

describe('startTaskScheduler — auto-dismiss', () => {
  it('dismisses due notification when task transitions to done', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const disposeMock = vi.fn()
    vi.spyOn(api.notifications, 'createNotification').mockReturnValue({ dispose: disposeMock })

    // Startup tick: due task fires notification → dueTaskNotifs has 'done-task'
    // Second tick: auto-dismiss due runs (map non-empty) and finds task resolved
    mockAll
      .mockReturnValueOnce([
        { id: 'done-task', text: 'Will be done', due_date: '2026-05-26', metadata: '{}' },
      ])
      .mockReturnValue([]) // blocked tasks (startup) + all subsequent

    // Startup auto-dismiss is always skipped (maps empty at that point).
    // First mockAutoDismissAll call = second tick's auto-dismiss due query.
    mockAutoDismissAll.mockReturnValueOnce([{ id: 'done-task' }])

    const { tick, dispose } = startTaskScheduler(api)
    tick() // second tick — auto-dismiss fires
    dispose()

    expect(disposeMock).toHaveBeenCalledTimes(1)
  })

  it('dismisses blocked notification when task becomes unblocked', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const disposeMock = vi.fn()
    vi.spyOn(api.notifications, 'createNotification').mockReturnValue({ dispose: disposeMock })

    // Startup: no due tasks, one blocked task → notification created → blockedTaskNotifs has 'b1'
    // Second tick: auto-dismiss blocked runs and finds task is now unblocked
    mockAll
      .mockReturnValueOnce([]) // startup due tasks
      .mockReturnValueOnce([blockedRow()]) // startup blocked tasks → notification fires
      .mockReturnValue([]) // all subsequent queries

    // Startup auto-dismiss is skipped (maps empty). Second tick runs auto-dismiss blocked.
    // dueTaskNotifs is empty on second tick so auto-dismiss due is skipped too.
    // First mockAutoDismissAll call = second tick's auto-dismiss blocked query.
    mockAutoDismissAll.mockReturnValueOnce([{ id: 'b1' }])

    const { tick, dispose } = startTaskScheduler(api)
    tick()
    dispose()

    expect(disposeMock).toHaveBeenCalledTimes(1)
  })
})

describe('startTaskScheduler — blocked tasks', () => {
  it('fires an info notification when blocked interval has elapsed', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll.mockReturnValueOnce([]).mockReturnValue([blockedRow()])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        title: expect.stringContaining('Blocked task'),
      })
    )
  })

  it('skips blocked task when interval has not yet elapsed', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // updated_at = 30 minutes ago, interval = 1-hour → not elapsed
    const row = blockedRow({
      updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      metadata: JSON.stringify({ blocked_check_interval: '1-hour' }),
    })
    mockAll.mockReturnValueOnce([]).mockReturnValue([row])

    const { dispose } = startTaskScheduler(api)
    dispose()

    const infoCalls = createNotification.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'info'
    )
    expect(infoCalls).toHaveLength(0)
  })

  it('handles invalid metadata JSON gracefully', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll.mockReturnValueOnce([]).mockReturnValue([blockedRow({ metadata: 'NOT_JSON' })])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
  })

  it('skips blocked task with no check interval in metadata', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll
      .mockReturnValueOnce([])
      .mockReturnValue([blockedRow({ metadata: JSON.stringify({ blocked_reason: 'waiting' }) })])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
  })

  it('handles custom ISO datetime interval that has passed', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // Custom ISO datetime: 1 hour ago
    const targetTime = new Date(Date.now() - 60_000).toISOString()
    mockAll.mockReturnValueOnce([]).mockReturnValue([
      blockedRow({
        updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        metadata: JSON.stringify({ blocked_check_interval: targetTime }),
      }),
    ])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
  })

  it('skips notification when db is not yet initialized (throws)', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })

    // Override getDb mock to throw for this test
    mockPrepare.mockImplementationOnce(() => {
      throw new Error('DB not ready')
    })

    const { dispose } = startTaskScheduler(api)
    dispose()
    // Should not throw — error is caught in tick
  })
})

describe('broadcast via action handler', () => {
  it('action handler sends IPC to all windows', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll
      .mockReturnValueOnce([{ id: 't-action', text: 'Action task', metadata: '{}' }])
      .mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    const call = createNotification.mock.calls[0]?.[0] as {
      actions: Array<{ handler: () => void }>
    }
    expect(call?.actions).toHaveLength(1)
    call.actions[0].handler()
    expect(mockSend).toHaveBeenCalledWith(
      'task-vault:navigate-task',
      expect.objectContaining({ taskId: 't-action' })
    )
  })
})

// ── per-task recurrence_notify_at column ──────────────────────────────────────

describe('startTaskScheduler — per-task recurrence_notify_at', () => {
  function dueTaskRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'r1',
      text: 'Recurring task',
      due_date: '2026-05-26',
      project_id: null,
      context: null,
      area_id: null,
      recurrence_notify_at: null,
      metadata: '{}',
      ...overrides,
    }
  }

  it('fires notification when current time >= recurrence_notify_at column value', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const row = dueTaskRow({ recurrence_notify_at: '10:00' })
    mockAll.mockReturnValueOnce([row]).mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', title: expect.stringContaining('Recurring task') })
    )
  })

  it('suppresses notification on non-startup tick when current time < recurrence_notify_at', () => {
    vi.setSystemTime(new Date('2026-05-26T08:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '07:00') } }) // global alert is past
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // Task has recurrence_notify_at = 09:00 — current time 08:00 should suppress on regular tick
    const row = dueTaskRow({ recurrence_notify_at: '09:00' })
    // Startup tick sees empty; second tick sees the row
    mockAll
      .mockReturnValueOnce([]) // startup due tasks
      .mockReturnValueOnce([]) // startup blocked tasks
      .mockReturnValueOnce([row]) // second tick due tasks
      .mockReturnValue([])

    const { tick, dispose } = startTaskScheduler(api)
    tick() // non-startup tick
    dispose()

    expect(createNotification).not.toHaveBeenCalled()
  })

  it('falls back to global alert time when task has no recurrence_time', () => {
    vi.setSystemTime(new Date('2026-05-26T09:30:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const row = dueTaskRow({ metadata: '{}' })
    mockAll.mockReturnValueOnce([row]).mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).toHaveBeenCalled()
  })
})

// ── scheduler does NOT spawn recurrences ───────────────────────────────────────
// Spawn is handled by ensureNextOccurrence called from complete-task and set-recurrence.
// The scheduler is notification-only.

describe('startTaskScheduler — scheduler never inserts task rows', () => {
  function recurringRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-1',
      text: 'Daily standup',
      due_date: '2026-05-26',
      project_id: null,
      context: null,
      area_id: null,
      recurrence_rule: 'daily',
      recurrence_notify_at: null,
      metadata: '{}',
      ...overrides,
    }
  }

  it('fires a notification for a recurring task but does NOT insert a new task row', () => {
    vi.setSystemTime(new Date('2026-05-26T09:30:00'))
    const createNotification = vi.fn(() => ({ dispose: vi.fn() }))
    const api = makeApi({
      settings: { get: vi.fn(() => '09:00') },
      notifications: { createNotification },
    })

    mockAll.mockReturnValueOnce([recurringRow()]).mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    // Notification fired
    expect(createNotification).toHaveBeenCalled()

    // No INSERT INTO tasks from the scheduler
    const insertSql = mockPrepare.mock.calls.find(([sql]: [string]) =>
      (sql as string).startsWith('INSERT INTO tasks')
    )?.[0] as string | undefined
    expect(insertSql).toBeUndefined()
  })

  it('uses recurrence_notify_at column (not meta.recurrence_time) for alert time', () => {
    vi.setSystemTime(new Date('2026-05-26T08:30:00')) // before 10:00
    const createNotification = vi.fn(() => ({ dispose: vi.fn() }))
    const api = makeApi({
      settings: { get: vi.fn(() => '08:00') }, // global alert is past
      notifications: { createNotification },
    })

    // recurrence_notify_at = 10:00 — at 08:30 on a non-startup tick, should NOT fire
    const row = recurringRow({ recurrence_notify_at: '10:00' })
    mockAll
      .mockReturnValueOnce([]) // startup due tasks
      .mockReturnValueOnce([]) // startup blocked tasks
      .mockReturnValueOnce([row]) // second tick due tasks
      .mockReturnValue([])

    const { tick, dispose } = startTaskScheduler(api)
    tick() // non-startup tick
    dispose()

    expect(createNotification).not.toHaveBeenCalled()
  })
})

// ── OS system notifications (Notification.isSupported = true) ─────────────────

describe('startTaskScheduler — OS system notifications', () => {
  it('shows an OS notification for a due task when Notification.isSupported returns true', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    mockNotifIsSupported.mockReturnValue(true)

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    mockAll.mockImplementation((date: string) => {
      if (typeof date === 'string' && date.startsWith('2026')) {
        return [
          {
            id: 't-os',
            text: 'OS Due Task',
            due_date: '2026-05-26',
            metadata: '{}',
            recurrence_notify_at: null,
          },
        ]
      }
      return []
    })

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(mockOsNotif.show).toHaveBeenCalled()
  })

  it('OS notification click handler broadcasts navigate-task for due task', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    mockNotifIsSupported.mockReturnValue(true)

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    mockAll.mockImplementation((date: string) => {
      if (typeof date === 'string' && date.startsWith('2026')) {
        return [
          {
            id: 't-click',
            text: 'Clickable',
            due_date: '2026-05-26',
            metadata: '{}',
            recurrence_notify_at: null,
          },
        ]
      }
      return []
    })

    const { dispose } = startTaskScheduler(api)
    dispose()

    const clickArgs = mockOsNotif.on.mock.calls.find(([event]: [string]) => event === 'click')
    expect(clickArgs).toBeTruthy()
    clickArgs![1]()
    expect(mockSend).toHaveBeenCalledWith(
      'task-vault:navigate-task',
      expect.objectContaining({ taskId: 't-click' })
    )
  })

  it('shows an OS notification for a blocked task when Notification.isSupported returns true', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    mockNotifIsSupported.mockReturnValue(true)

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    // First mockAll call = due tasks (empty), second = blocked tasks
    mockAll.mockReturnValueOnce([]).mockReturnValue([
      blockedRow({
        id: 'b-os',
        text: 'OS Blocked Task',
        metadata: JSON.stringify({
          blocked_check_interval: '1-hour',
          blocked_reason: 'waiting on PR',
        }),
      }),
    ])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(mockOsNotif.show).toHaveBeenCalled()
  })
})

// ── midnight dedup reset ──────────────────────────────────────────────────────

describe('startTaskScheduler — midnight dedup reset', () => {
  it('clears due-task dedup set at midnight and re-fires on next day tick', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const dueRow = {
      id: 't-mid',
      text: 'Midnight task',
      due_date: '2026-05-26',
      metadata: '{}',
      recurrence_notify_at: null,
    }
    mockAll.mockReturnValue([dueRow])

    const { tick, dispose } = startTaskScheduler(api)
    // Startup fires. Advance past midnight → dedup set clears → fires again.
    vi.setSystemTime(new Date('2026-05-27T10:00:00'))
    tick()
    dispose()

    expect(createNotification.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
