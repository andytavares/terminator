import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    mkdir: vi.fn(),
    stat: vi.fn(),
    readdir: vi.fn(),
  }
})

const { mockHandle, mockRemoveHandler } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
  Notification: Object.assign(
    vi.fn(() => ({ show: vi.fn() })),
    { isSupported: vi.fn(() => false) }
  ),
}))

vi.mock('../../src/notifications/task-scheduler.js', () => ({
  triggerSchedulerTick: vi.fn(),
  broadcast: vi.fn(),
}))

vi.mock('gray-matter', () => ({
  default: vi.fn((content: string) => ({ content, data: {} })),
}))

vi.mock('../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue({ tasks: [], projects: [], inboxCount: 0 }),
}))

const { mockRun, mockGet, mockAll, mockPrepare } = vi.hoisted(() => {
  const mockRun = vi.fn()
  const mockGet = vi.fn()
  const mockAll = vi.fn().mockReturnValue([])
  const mockPrepare = vi.fn().mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  return { mockRun, mockGet, mockAll, mockPrepare }
})
vi.mock('../../src/vault/db', () => ({
  getDb: vi.fn(() => ({ prepare: mockPrepare })),
  randomUUID: vi.fn(() => 'test-uuid'),
}))

import { registerVaultIpcHandlers } from '../../src/ipc/vault.ipc'

const TASK_ID = 'task-uuid-1'
const TASK_ROW = {
  id: TASK_ID,
  status: 'open',
  text: 'Item one',
  source: 'inbox',
  terminator_links: '[]',
}

beforeEach(() => {
  vi.clearAllMocks()
  mockPrepare.mockReturnValue({ run: mockRun, get: mockGet, all: mockAll })
  mockGet.mockReturnValue(TASK_ROW)
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
  vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >)
})

function getHandler(channel: string): (event: unknown, payload: unknown) => Promise<unknown> {
  let handler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
  vi.mocked(mockHandle).mockImplementation((ch, fn) => {
    if (ch === channel) handler = fn as typeof handler
  })
  registerVaultIpcHandlers()
  if (!handler) throw new Error(`Handler for ${channel} not registered`)
  return handler
}

describe('task-vault:vault:process-inbox-item', () => {
  it('action:trash removes item from inbox', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: TASK_ID, action: 'trash' })
    expect(result).toMatchObject({ success: true })
  })

  it('action:do-now moves task to today daily log', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: TASK_ID, action: 'do-now' })
    expect(result).toMatchObject({ success: true })
    // Two UPDATE statements: one for task, one for subtasks
    expect(mockRun).toHaveBeenCalledTimes(2)
  })

  it('action:someday files to someday', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: TASK_ID, action: 'someday' })
    expect(result).toMatchObject({ success: true })
  })

  it('action:someday clears today_since so task is not immediately stale on return', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    await handler({}, { taskId: TASK_ID, action: 'someday' })
    const preparedSqls: string[] = vi.mocked(mockPrepare).mock.calls.map((c) => c[0] as string)
    expect(preparedSqls.some((sql) => sql.includes('today_since=NULL'))).toBe(true)
  })

  it('action:file with destination files to destination', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler(
      {},
      { taskId: TASK_ID, action: 'file', destination: 'projects/alpha.md' }
    )
    expect(result).toMatchObject({ success: true, newTaskId: TASK_ID })
  })

  it('action:file with newProjectName creates project if missing and files task', async () => {
    // First get() returns the task, second get() returns undefined (project not found)
    mockGet.mockReturnValueOnce(TASK_ROW).mockReturnValueOnce(undefined)
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler(
      {},
      { taskId: TASK_ID, action: 'file', newProjectName: 'Brand New Project' }
    )
    expect(result).toMatchObject({ success: true, newTaskId: TASK_ID })
  })

  it('action:file with newProjectName skips insert when project exists', async () => {
    // First get() returns the task, second get() returns existing project
    mockGet.mockReturnValueOnce(TASK_ROW).mockReturnValueOnce({ id: 'existing-proj' })
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler(
      {},
      { taskId: TASK_ID, action: 'file', newProjectName: 'Existing Project' }
    )
    expect(result).toMatchObject({ success: true, newTaskId: TASK_ID })
  })

  it('action:file without destination or newProjectName returns error', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: TASK_ID, action: 'file' })
    expect(result).toMatchObject({ error: 'destination required for action: file' })
  })

  it('returns STALE_ID when task not found', async () => {
    mockGet.mockReturnValueOnce(undefined)
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: TASK_ID, action: 'trash' })
    expect(result).toMatchObject({ error: 'STALE_ID' })
  })

  it('returns VALIDATION_ERROR for invalid payload', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: TASK_ID, action: 'invalid-action' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})
