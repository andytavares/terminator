import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ExtensionDB } from '../../../../src/main/extensions/api'

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
    vi.fn(function () {
      return mockOsNotif
    }),
    {
      isSupported: mockNotifIsSupported,
    }
  ),
}))

// ── DB mock factory ──────────────────────────────────────────────────────────

/**
 * Routes db.query calls by SQL content:
 *   - auto-dismiss due: SQL contains "status IN ('done','cancelled','migrated')"
 *   - auto-dismiss blocked: SQL contains "status != 'blocked'"
 *   - blocked tasks: SQL contains "status='blocked'"
 *   - due tasks: all others
 */
function createMockDb() {
  const mockAll = vi.fn().mockResolvedValue([])
  const mockBlockedAll = vi.fn().mockResolvedValue([])
  const mockAutoDismissAll = vi.fn().mockResolvedValue([])
  const mockRun = vi.fn().mockResolvedValue(undefined)

  const db: ExtensionDB = {
    query: vi.fn().mockImplementation(async (sql: string) => {
      if (
        sql.includes("status IN ('done','cancelled','migrated')") ||
        sql.includes("status != 'blocked'")
      ) {
        return mockAutoDismissAll()
      }
      if (sql.includes("status='blocked'")) {
        return mockBlockedAll()
      }
      return mockAll()
    }),
    get: vi.fn().mockResolvedValue(undefined),
    run: mockRun,
    exec: vi.fn().mockResolvedValue(undefined),
    transaction: vi.fn(),
  }

  return {
    db,
    mockAll,
    mockBlockedAll,
    mockAutoDismissAll,
    mockRun,
    mockQuery: db.query as ReturnType<typeof vi.fn>,
  }
}

type MockDb = ReturnType<typeof createMockDb>

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
    source_ref: null,
    ...overrides,
  }
}

let mock: MockDb

beforeEach(() => {
  vi.clearAllMocks()
  mock = createMockDb()
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
  it('returns dispose function that clears the interval', async () => {
    vi.spyOn(global, 'setInterval')
    const api = makeApi()
    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    expect(setInterval).toHaveBeenCalled()
    scheduler.dispose()
  })

  it('returns a tick function', async () => {
    const api = makeApi()
    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    expect(typeof scheduler.tick).toBe('function')
    scheduler.dispose()
  })
})

describe('startTaskScheduler — due tasks', () => {
  it('fires a warning notification for a due open task past alert time', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({
      settings: { get: vi.fn((_k: string) => '09:00') },
    })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockAll.mockResolvedValue([
      { id: 't1', text: 'Finish report', due_date: '2026-05-26', metadata: '{}' },
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    // Second tick to confirm dedup
    await scheduler.tickAsync()
    scheduler.dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: expect.stringContaining('Finish report'),
      })
    )
  })

  it('fires notification on startup even before configured alert time', async () => {
    vi.setSystemTime(new Date('2026-05-26T07:00:00'))

    const api = makeApi({
      settings: { get: vi.fn((_k: string) => '09:00') },
    })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockAll.mockResolvedValueOnce([
      { id: 't1', text: 'Early task', due_date: '2026-05-26', metadata: '{}' },
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringContaining('Early task') })
    )
  })

  it('does not fire notification on a non-startup tick when current time is before alert time', async () => {
    vi.setSystemTime(new Date('2026-05-26T08:00:00'))

    const api = makeApi({
      settings: { get: vi.fn((_k: string) => '09:00') },
    })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // Startup tick sees no tasks; subsequent tick sees a new task before alert time
    mock.mockAll
      .mockResolvedValueOnce([]) // startup: due tasks empty
      .mockResolvedValueOnce([
        { id: 't2', text: 'New task', due_date: '2026-05-26', metadata: '{}' },
      ]) // 2nd tick: due

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    await scheduler.tickAsync() // non-startup tick — should not fire (before alert time)
    scheduler.dispose()

    expect(createNotification).not.toHaveBeenCalled()
  })

  it('fires error notification for overdue tasks (past due date)', async () => {
    vi.setSystemTime(new Date('2026-05-26T07:00:00'))

    const api = makeApi({
      settings: { get: vi.fn((_k: string) => '09:00') },
    })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockAll.mockResolvedValueOnce([
      { id: 'od1', text: 'Overdue task', due_date: '2026-05-25', metadata: '{}' },
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        title: 'Overdue: Overdue task',
      })
    )
  })

  it('deduplicates due task notifications within the same day (in-memory)', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockAll.mockResolvedValue([{ id: 'dup', text: 'Dup task', metadata: '{}' }])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    await scheduler.tickAsync() // second tick
    scheduler.dispose()

    // Should only fire once despite two ticks (in-memory dedup set)
    const warningCalls = createNotification.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'warning'
    )
    expect(warningCalls).toHaveLength(1)
  })

  it('skips notification for tasks already notified in the same session (in-session dedup)', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const row = {
      id: 'already',
      text: 'Already notified',
      due_date: '2026-05-26',
      recurrence_notify_at: null,
      metadata: '{}',
    }
    // Startup tick → notifies, second tick → skip (in-session dedup)
    mock.mockAll
      .mockResolvedValueOnce([row]) // startup
      .mockResolvedValueOnce([row]) // second tick

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    await scheduler.tickAsync() // second tick
    scheduler.dispose()

    const warningCalls = createNotification.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'warning'
    )
    expect(warningCalls).toHaveLength(1)
  })

  it('does not write notification_notified_date to task metadata (dedup is in-session only)', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })

    mock.mockAll.mockResolvedValueOnce([
      {
        id: 'persist',
        text: 'Persist me',
        due_date: '2026-05-26',
        recurrence_notify_at: null,
        metadata: '{}',
      },
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    // The scheduler must NOT write notification_notified_date to metadata
    const updateCalls = mock.mockRun.mock.calls.filter((args) => {
      const metaArg = args[0] as string
      return typeof metaArg === 'string' && metaArg.includes('notification_notified_date')
    })
    expect(updateCalls).toHaveLength(0)
  })
})

describe('startTaskScheduler — auto-dismiss', () => {
  it('dismisses due notification when task transitions to done', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const disposeMock = vi.fn()
    vi.spyOn(api.notifications, 'createNotification').mockReturnValue({ dispose: disposeMock })

    // Startup: due task fires notification → dueTaskNotifs has 'done-task'
    mock.mockAll.mockResolvedValueOnce([
      { id: 'done-task', text: 'Will be done', due_date: '2026-05-26', metadata: '{}' },
    ])

    // Second tick auto-dismiss due query finds task resolved
    mock.mockAutoDismissAll.mockResolvedValueOnce([{ id: 'done-task' }])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    await scheduler.tickAsync() // second tick — auto-dismiss fires
    scheduler.dispose()

    expect(disposeMock).toHaveBeenCalledTimes(1)
  })

  it('dismisses blocked notification when task becomes unblocked', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const disposeMock = vi.fn()
    vi.spyOn(api.notifications, 'createNotification').mockReturnValue({ dispose: disposeMock })

    // Startup: no due tasks, one blocked task → notification created
    mock.mockBlockedAll.mockResolvedValueOnce([blockedRow()])

    // Second tick auto-dismiss blocked finds task unblocked
    mock.mockAutoDismissAll.mockResolvedValueOnce([{ id: 'b1' }])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    await scheduler.tickAsync() // second tick — auto-dismiss fires
    scheduler.dispose()

    expect(disposeMock).toHaveBeenCalledTimes(1)
  })
})

describe('startTaskScheduler — blocked tasks', () => {
  it('fires an info notification when blocked interval has elapsed', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockBlockedAll.mockResolvedValue([blockedRow()])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'info',
        title: expect.stringContaining('Blocked task'),
      })
    )
  })

  it('skips blocked task when interval has not yet elapsed', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // updated_at = 30 minutes ago, interval = 1-hour → not elapsed
    const row = blockedRow({
      updated_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      metadata: JSON.stringify({ blocked_check_interval: '1-hour' }),
    })
    mock.mockBlockedAll.mockResolvedValue([row])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    const infoCalls = createNotification.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'info'
    )
    expect(infoCalls).toHaveLength(0)
  })

  it('handles invalid metadata JSON gracefully', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockBlockedAll.mockResolvedValue([blockedRow({ metadata: 'NOT_JSON' })])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
  })

  it('skips blocked task with no check interval in metadata', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockBlockedAll.mockResolvedValue([
      blockedRow({ metadata: JSON.stringify({ blocked_reason: 'waiting' }) }),
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(createNotification).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
  })

  it('handles custom ISO datetime interval that has passed', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const targetTime = new Date(Date.now() - 60_000).toISOString()
    mock.mockBlockedAll.mockResolvedValue([
      blockedRow({
        updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        metadata: JSON.stringify({ blocked_check_interval: targetTime }),
      }),
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(createNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }))
  })

  it('skips notification when db.query throws', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })

    mock.mockQuery.mockRejectedValueOnce(new Error('DB not ready'))

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise // should not throw
    scheduler.dispose()
  })
})

describe('broadcast via action handler', () => {
  it('action handler sends IPC to all windows', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockAll.mockResolvedValueOnce([{ id: 't-action', text: 'Action task', metadata: '{}' }])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

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

  it('fires notification when current time >= recurrence_notify_at column value', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const row = dueTaskRow({ recurrence_notify_at: '10:00' })
    mock.mockAll.mockResolvedValueOnce([row])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', title: expect.stringContaining('Recurring task') })
    )
  })

  it('suppresses notification on non-startup tick when current time < recurrence_notify_at', async () => {
    vi.setSystemTime(new Date('2026-05-26T08:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '07:00') } }) // global alert is past

    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const row = dueTaskRow({ recurrence_notify_at: '09:00' })
    // Startup sees empty; second tick sees the row
    mock.mockAll
      .mockResolvedValueOnce([]) // startup
      .mockResolvedValueOnce([row]) // second tick

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    await scheduler.tickAsync() // non-startup tick
    scheduler.dispose()

    expect(createNotification).not.toHaveBeenCalled()
  })

  it('falls back to global alert time when task has no recurrence_time', async () => {
    vi.setSystemTime(new Date('2026-05-26T09:30:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const row = dueTaskRow({ metadata: '{}' })
    mock.mockAll.mockResolvedValueOnce([row])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(createNotification).toHaveBeenCalled()
  })
})

// ── scheduler does NOT spawn recurrences ───────────────────────────────────────

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

  it('fires a notification for a recurring task but does NOT insert a new task row', async () => {
    vi.setSystemTime(new Date('2026-05-26T09:30:00'))
    const createNotification = vi.fn(() => ({ dispose: vi.fn() }))
    const api = makeApi({
      settings: { get: vi.fn(() => '09:00') },
      notifications: { createNotification },
    })

    mock.mockAll.mockResolvedValueOnce([recurringRow()])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    // Notification fired
    expect(createNotification).toHaveBeenCalled()

    // No INSERT queries from the scheduler
    const insertCalls = mock.mockQuery.mock.calls.filter(
      ([sql]: [string]) => typeof sql === 'string' && sql.toUpperCase().startsWith('INSERT')
    )
    expect(insertCalls).toHaveLength(0)
  })

  it('uses recurrence_notify_at column (not meta.recurrence_time) for alert time', async () => {
    vi.setSystemTime(new Date('2026-05-26T08:30:00'))
    const createNotification = vi.fn(() => ({ dispose: vi.fn() }))
    const api = makeApi({
      settings: { get: vi.fn(() => '08:00') }, // global alert is past
      notifications: { createNotification },
    })

    // recurrence_notify_at = 10:00 — at 08:30 on a non-startup tick, should NOT fire
    const row = recurringRow({ recurrence_notify_at: '10:00' })
    mock.mockAll
      .mockResolvedValueOnce([]) // startup
      .mockResolvedValueOnce([row]) // second tick

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    await scheduler.tickAsync() // non-startup tick
    scheduler.dispose()

    expect(createNotification).not.toHaveBeenCalled()
  })
})

// ── OS system notifications (Notification.isSupported = true) ─────────────────

describe('startTaskScheduler — OS system notifications', () => {
  it('shows an OS notification for a due task when Notification.isSupported returns true', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    mockNotifIsSupported.mockReturnValue(true)

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    mock.mockAll.mockResolvedValue([
      {
        id: 't-os',
        text: 'OS Due Task',
        due_date: '2026-05-26',
        metadata: '{}',
        recurrence_notify_at: null,
      },
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(mockOsNotif.show).toHaveBeenCalled()
  })

  it('OS notification click handler broadcasts navigate-task with source_ref (not due_date)', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    mockNotifIsSupported.mockReturnValue(true)

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    mock.mockAll.mockResolvedValue([
      {
        id: 't-click',
        text: 'Clickable',
        due_date: '2026-05-26',
        source_ref: '2026-05-20',
        metadata: '{}',
        recurrence_notify_at: null,
      },
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    const clickArgs = mockOsNotif.on.mock.calls.find(([event]: [string]) => event === 'click')
    expect(clickArgs).toBeTruthy()
    clickArgs![1]()
    expect(mockSend).toHaveBeenCalledWith(
      'task-vault:navigate-task',
      expect.objectContaining({ taskId: 't-click', date: '2026-05-20' })
    )
  })

  it('shows an OS notification for a blocked task when Notification.isSupported returns true', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    mockNotifIsSupported.mockReturnValue(true)

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    mock.mockBlockedAll.mockResolvedValue([
      blockedRow({
        id: 'b-os',
        text: 'OS Blocked Task',
        metadata: JSON.stringify({
          blocked_check_interval: '1-hour',
          blocked_reason: 'waiting on PR',
        }),
      }),
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    expect(mockOsNotif.show).toHaveBeenCalled()
  })

  it('OS notification click handler for blocked task broadcasts { taskId, date }', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    mockNotifIsSupported.mockReturnValue(true)

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    mock.mockBlockedAll.mockResolvedValue([
      blockedRow({
        id: 'b-click',
        source_ref: '2026-05-20',
        metadata: JSON.stringify({ blocked_check_interval: '1-hour' }),
      }),
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    const clickArgs = mockOsNotif.on.mock.calls.find(([event]: [string]) => event === 'click')
    expect(clickArgs).toBeTruthy()
    clickArgs![1]()
    expect(mockSend).toHaveBeenCalledWith(
      'task-vault:navigate-task',
      expect.objectContaining({ taskId: 'b-click', date: '2026-05-20' })
    )
  })

  it('in-app action handler for blocked task broadcasts { taskId, date }', async () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))
    mockNotifIsSupported.mockReturnValue(false)

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mock.mockBlockedAll.mockResolvedValue([
      blockedRow({
        id: 'b-inapp',
        source_ref: '2026-05-21',
        metadata: JSON.stringify({ blocked_check_interval: '1-hour' }),
      }),
    ])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    scheduler.dispose()

    const call = createNotification.mock.calls[0]?.[0] as {
      actions: Array<{ handler: () => void }>
    }
    expect(call?.actions).toHaveLength(1)
    call.actions[0].handler()
    expect(mockSend).toHaveBeenCalledWith(
      'task-vault:navigate-task',
      expect.objectContaining({ taskId: 'b-inapp', date: '2026-05-21' })
    )
  })
})

// ── midnight dedup reset ──────────────────────────────────────────────────────

describe('startTaskScheduler — midnight dedup reset', () => {
  it('clears due-task dedup set at midnight and re-fires on next day tick', async () => {
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
    mock.mockAll.mockResolvedValue([dueRow])

    const scheduler = startTaskScheduler(api, mock.db)
    await scheduler.startupPromise
    // Advance past midnight → dedup set clears → fires again
    vi.setSystemTime(new Date('2026-05-27T10:00:00'))
    await scheduler.tickAsync()
    scheduler.dispose()

    expect(createNotification.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})
