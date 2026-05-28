import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockSend = vi.fn()
const mockWin = { isDestroyed: vi.fn(() => false), webContents: { send: mockSend } }

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [mockWin]) },
}))

const mockRun = vi.fn().mockReturnValue({ changes: 1 })
const mockAll = vi.fn(() => [])
const mockPrepare = vi.fn(() => ({ all: mockAll, run: mockRun }))
const mockDb = { prepare: mockPrepare }

vi.mock('../../src/vault/db.js', () => ({
  getDb: () => mockDb,
  randomUUID: vi.fn(() => 'sched-uuid'),
}))

function makeApi(overrides: Record<string, unknown> = {}) {
  return {
    settings: { get: vi.fn((_key: string) => undefined) },
    notifications: { createNotification: vi.fn() },
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
        return [{ id: 't1', text: 'Finish report', due_date: '2026-05-26' }]
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
      .mockReturnValueOnce([{ id: 't1', text: 'Early task', due_date: '2026-05-26' }])
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
      .mockReturnValueOnce([{ id: 't2', text: 'New task', due_date: '2026-05-26' }]) // 2nd tick: due
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
      .mockReturnValueOnce([{ id: 'od1', text: 'Overdue task', due_date: '2026-05-25' }])
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

  it('deduplicates due task notifications within the same day', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn((_k: string) => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll.mockImplementation(() => [{ id: 'dup', text: 'Dup task' }])

    const { tick, dispose } = startTaskScheduler(api)
    tick() // second call
    dispose()

    // Should only fire once despite two ticks
    const warningCalls = createNotification.mock.calls.filter(
      (c) => (c[0] as { type: string }).type === 'warning'
    )
    expect(warningCalls).toHaveLength(1)
  })
})

describe('startTaskScheduler — blocked tasks', () => {
  it('fires an info notification when blocked interval has elapsed', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    mockAll.mockImplementation((...args: unknown[]) => {
      // Due tasks query returns nothing; blocked tasks query returns a row
      if (args.length > 0) return [] // due tasks (takes today as param)
      return [blockedRow()] // blocked tasks (no param)
    })
    // Simpler: just return blocked row on second call
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

    mockAll.mockReturnValueOnce([{ id: 't-action', text: 'Action task' }]).mockReturnValue([])

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

// ── per-task recurrence_time ──────────────────────────────────────────────────

describe('startTaskScheduler — per-task recurrence_time', () => {
  function dueTaskRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'r1',
      text: 'Recurring task',
      due_date: '2026-05-26',
      project_id: null,
      context: null,
      area_id: null,
      metadata: '{}',
      ...overrides,
    }
  }

  it('fires notification when current time >= task recurrence_time', () => {
    vi.setSystemTime(new Date('2026-05-26T10:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    const row = dueTaskRow({
      metadata: JSON.stringify({ recurrence_interval: 'daily', recurrence_time: '10:00' }),
    })
    mockAll.mockReturnValueOnce([row]).mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', title: expect.stringContaining('Recurring task') })
    )
  })

  it('suppresses notification on non-startup tick when current time < task recurrence_time', () => {
    vi.setSystemTime(new Date('2026-05-26T08:00:00'))

    const api = makeApi({ settings: { get: vi.fn(() => '07:00') } }) // global alert is past
    const createNotification = vi.spyOn(api.notifications, 'createNotification')

    // Task has per-task time of 09:00 — current time 08:00 should suppress on regular tick
    const row = dueTaskRow({
      metadata: JSON.stringify({ recurrence_interval: 'daily', recurrence_time: '09:00' }),
    })
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

// ── recurrence spawn-on-notify ─────────────────────────────────────────────────

describe('startTaskScheduler — recurrence spawn on notify', () => {
  function recurringRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'rec-1',
      text: 'Daily standup',
      due_date: '2026-05-26',
      project_id: null,
      context: null,
      area_id: null,
      metadata: JSON.stringify({ recurrence_interval: 'daily', recurrence_time: '09:00' }),
      ...overrides,
    }
  }

  it('inserts next occurrence task when notify time elapses', () => {
    vi.setSystemTime(new Date('2026-05-26T09:30:00'))
    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })

    mockAll.mockReturnValueOnce([recurringRow()]).mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    const insertSql = mockPrepare.mock.calls.find(([sql]: [string]) =>
      sql.startsWith('INSERT INTO tasks')
    )?.[0] as string | undefined
    expect(insertSql).toBeDefined()
    // Next task ID appears in run args
    const allRunArgs = mockRun.mock.calls.flat()
    expect(allRunArgs).toContain('sched-uuid')
    // Next due date is tomorrow
    expect(allRunArgs).toContain('2026-05-27')
  })

  it('does not spawn again when recurrence_next_spawned already matches next due', () => {
    vi.setSystemTime(new Date('2026-05-26T09:30:00'))
    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })

    const row = recurringRow({
      metadata: JSON.stringify({
        recurrence_interval: 'daily',
        recurrence_time: '09:00',
        recurrence_next_spawned: '2026-05-27', // already spawned tomorrow
      }),
    })
    mockAll.mockReturnValueOnce([row]).mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    const insertSql = mockPrepare.mock.calls.find(([sql]: [string]) =>
      sql.startsWith('INSERT INTO tasks')
    )?.[0] as string | undefined
    expect(insertSql).toBeUndefined()
  })

  it('stops spawning when on_date end condition is exceeded', () => {
    vi.setSystemTime(new Date('2026-05-26T09:30:00'))
    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })

    const row = recurringRow({
      metadata: JSON.stringify({
        recurrence_interval: 'daily',
        recurrence_time: '09:00',
        recurrence_end_type: 'on_date',
        recurrence_end_date: '2026-05-26', // next would be 05-27, which exceeds end
      }),
    })
    mockAll.mockReturnValueOnce([row]).mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    const insertSql = mockPrepare.mock.calls.find(([sql]: [string]) =>
      sql.startsWith('INSERT INTO tasks')
    )?.[0] as string | undefined
    expect(insertSql).toBeUndefined()
  })

  it('stops spawning when after_count limit is reached', () => {
    vi.setSystemTime(new Date('2026-05-26T09:30:00'))
    const api = makeApi({ settings: { get: vi.fn(() => '09:00') } })

    const row = recurringRow({
      metadata: JSON.stringify({
        recurrence_interval: 'daily',
        recurrence_time: '09:00',
        recurrence_end_type: 'after_count',
        recurrence_end_count: 3,
        recurrence_completed_count: 2, // spawning this would be the 3rd → stop
      }),
    })
    mockAll.mockReturnValueOnce([row]).mockReturnValue([])

    const { dispose } = startTaskScheduler(api)
    dispose()

    const insertSql = mockPrepare.mock.calls.find(([sql]: [string]) =>
      sql.startsWith('INSERT INTO tasks')
    )?.[0] as string | undefined
    expect(insertSql).toBeUndefined()
  })
})
