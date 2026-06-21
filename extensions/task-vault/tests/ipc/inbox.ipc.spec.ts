import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as fs from 'node:fs/promises'
import type { ExtensionDB } from '../../../../src/main/extensions/api'

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

vi.mock('../../src/vault/db', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}))

import { registerVaultIpcHandlers } from '../../src/ipc/vault.ipc'

function createMockDb() {
  const mockQuery = vi.fn().mockResolvedValue([])
  const mockGet = vi.fn().mockResolvedValue(undefined)
  const mockRun = vi.fn().mockResolvedValue(undefined)
  const db: ExtensionDB = {
    query: mockQuery,
    get: mockGet,
    run: mockRun,
    exec: vi.fn().mockResolvedValue(undefined),
    transaction: vi
      .fn()
      .mockImplementation(async (fn: (tx: ExtensionDB) => Promise<unknown>) => fn(db)),
  }
  return Object.assign(db, { mockQuery, mockGet, mockRun })
}

const TASK_ID = 'task-uuid-1'
const TASK_ROW = {
  id: TASK_ID,
  status: 'open',
  text: 'Item one',
  source: 'inbox',
  terminator_links: '[]',
}

let db: ReturnType<typeof createMockDb>

beforeEach(() => {
  vi.clearAllMocks()
  db = createMockDb()
  db.mockGet.mockResolvedValue(TASK_ROW)
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
  registerVaultIpcHandlers(db)
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
    expect(db.mockRun).toHaveBeenCalledTimes(2)
  })

  it('action:someday files to someday', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler({}, { taskId: TASK_ID, action: 'someday' })
    expect(result).toMatchObject({ success: true })
  })

  it('action:someday clears today_since so task is not immediately stale on return', async () => {
    const handler = getHandler('task-vault:vault:process-inbox-item')
    await handler({}, { taskId: TASK_ID, action: 'someday' })
    const runSqls = db.mockRun.mock.calls.map((c) => c[0] as string)
    expect(runSqls.some((sql) => sql.includes('today_since=NULL'))).toBe(true)
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
    db.mockGet.mockResolvedValueOnce(TASK_ROW).mockResolvedValueOnce(undefined)
    const handler = getHandler('task-vault:vault:process-inbox-item')
    const result = await handler(
      {},
      { taskId: TASK_ID, action: 'file', newProjectName: 'Brand New Project' }
    )
    expect(result).toMatchObject({ success: true, newTaskId: TASK_ID })
  })

  it('action:file with newProjectName skips insert when project exists', async () => {
    // First get() returns the task, second get() returns existing project
    db.mockGet.mockResolvedValueOnce(TASK_ROW).mockResolvedValueOnce({ id: 'existing-proj' })
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
    db.mockGet.mockResolvedValueOnce(undefined)
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
