import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  default: vi.fn((content: string) => ({
    content,
    data: {},
  })),
}))

vi.mock('../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue({ tasks: [], projects: [], inboxCount: 0 }),
  readIndex: vi.fn().mockResolvedValue(null),
  getTaskById: vi.fn().mockReturnValue(null),
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

let db: ReturnType<typeof createMockDb>

beforeEach(() => {
  vi.clearAllMocks()
  db = createMockDb()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
  vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('task-vault:vault:capture IPC handler', () => {
  it('registers the capture handler', () => {
    registerVaultIpcHandlers(db)
    const registeredChannels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(registeredChannels).toContain('task-vault:vault:capture')
  })

  it('returns error for empty text payload', async () => {
    let captureHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:capture') captureHandler = fn as typeof captureHandler
    })
    registerVaultIpcHandlers(db)
    expect(captureHandler).toBeDefined()

    const result = await captureHandler!({} as Electron.IpcMainInvokeEvent, { text: '' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('returns error for whitespace-only text', async () => {
    let captureHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:capture') captureHandler = fn as typeof captureHandler
    })
    registerVaultIpcHandlers(db)

    const result = await captureHandler!({} as Electron.IpcMainInvokeEvent, { text: '   ' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('inserts into DB and returns taskId for valid text', async () => {
    let captureHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:capture') captureHandler = fn as typeof captureHandler
    })
    registerVaultIpcHandlers(db)

    const result = await captureHandler!({} as Electron.IpcMainInvokeEvent, { text: 'New task' })
    expect(result).toMatchObject({ taskId: 'test-uuid' })
  })

  it('validates payload with Zod schema', async () => {
    let captureHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:capture') captureHandler = fn as typeof captureHandler
    })
    registerVaultIpcHandlers(db)

    // null payload should fail validation
    const result = await captureHandler!({} as Electron.IpcMainInvokeEvent, null)
    expect(result).toMatchObject({ error: expect.any(String) })
  })
})
