import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
}))

vi.mock('gray-matter', () => ({
  default: vi.fn((content: string) => ({
    content,
    data: {},
  })),
}))

// Mock buildIndex to avoid complex fs setup
vi.mock('../../src/vault/indexer', () => ({
  buildIndex: vi.fn().mockResolvedValue({ tasks: [], projects: [], inboxCount: 0 }),
  readIndex: vi.fn().mockResolvedValue(null),
  getTaskById: vi.fn().mockReturnValue(null),
}))

import { registerVaultIpcHandlers, setVaultPath } from '../../src/ipc/vault.ipc'

const VAULT = '/vault'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(fs.mkdir).mockResolvedValue(undefined)
  vi.mocked(fs.readdir).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof fs.readdir>>)
  vi.mocked(fs.stat).mockResolvedValue({ mtime: new Date() } as unknown as Awaited<
    ReturnType<typeof fs.stat>
  >)
  setVaultPath(VAULT)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('task-vault:vault:capture IPC handler', () => {
  it('registers the capture handler', () => {
    registerVaultIpcHandlers()
    const registeredChannels = vi.mocked(mockHandle).mock.calls.map((c) => c[0])
    expect(registeredChannels).toContain('task-vault:vault:capture')
  })

  it('returns error for empty text payload', async () => {
    let captureHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:capture') captureHandler = fn as typeof captureHandler
    })
    registerVaultIpcHandlers()
    expect(captureHandler).toBeDefined()

    const result = await captureHandler!({} as Electron.IpcMainInvokeEvent, { text: '' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('returns error for whitespace-only text', async () => {
    let captureHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:capture') captureHandler = fn as typeof captureHandler
    })
    registerVaultIpcHandlers()

    const result = await captureHandler!({} as Electron.IpcMainInvokeEvent, { text: '   ' })
    expect(result).toMatchObject({ error: expect.stringContaining('VALIDATION_ERROR') })
  })

  it('writes to inbox.md for valid text', async () => {
    vi.mocked(fs.readFile).mockResolvedValue('- [ ] Existing\n' as unknown as Buffer)
    vi.mocked(fs.writeFile).mockResolvedValue()
    vi.mocked(fs.rename).mockResolvedValue()

    let captureHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:capture') captureHandler = fn as typeof captureHandler
    })
    registerVaultIpcHandlers()

    await captureHandler!({} as Electron.IpcMainInvokeEvent, { text: 'New task' })
    expect(vi.mocked(fs.writeFile)).toHaveBeenCalled()
    const written = vi.mocked(fs.writeFile).mock.calls[0][1] as string
    expect(written).toContain('New task')
  })

  it('validates payload with Zod schema', async () => {
    let captureHandler: ((event: unknown, payload: unknown) => Promise<unknown>) | undefined
    vi.mocked(mockHandle).mockImplementation((channel, fn) => {
      if (channel === 'task-vault:vault:capture') captureHandler = fn as typeof captureHandler
    })
    registerVaultIpcHandlers()

    // null payload should fail validation
    const result = await captureHandler!({} as Electron.IpcMainInvokeEvent, null)
    expect(result).toMatchObject({ error: expect.any(String) })
  })
})
