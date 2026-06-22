import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockHandle, mockRemoveHandler, mockHealthCheck } = vi.hoisted(() => ({
  mockHandle: vi.fn(),
  mockRemoveHandler: vi.fn(),
  mockHealthCheck: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, removeHandler: mockRemoveHandler },
}))

vi.mock('../../../src/main/db/index', () => ({
  healthCheck: mockHealthCheck,
}))

vi.mock('../../../src/main/logger', () => ({
  makeLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { registerDbIpcHandlers } from '../../../src/main/ipc/db.ipc'

describe('db:health IPC handler', () => {
  beforeEach(() => {
    mockHandle.mockClear()
    mockRemoveHandler.mockClear()
    mockHealthCheck.mockClear()
  })

  it('registers the db:health handler', () => {
    registerDbIpcHandlers()
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('db:health')
  })

  it('db:health returns { ok: true } when healthCheck succeeds', async () => {
    mockHealthCheck.mockResolvedValue({ ok: true })
    registerDbIpcHandlers()
    const handler = mockHandle.mock.calls.find((c) => c[0] === 'db:health')?.[1]
    expect(handler).toBeDefined()
    const result = await handler({})
    expect(result).toEqual({ ok: true })
  })

  it('db:health returns { ok: false, message } when healthCheck reports error', async () => {
    mockHealthCheck.mockResolvedValue({ ok: false, message: 'DB not initialized' })
    registerDbIpcHandlers()
    const handler = mockHandle.mock.calls.find((c) => c[0] === 'db:health')?.[1]
    const result = await handler({})
    expect(result).toEqual({ ok: false, message: 'DB not initialized' })
  })

  it('db:health returns { ok: false, message } when healthCheck throws', async () => {
    mockHealthCheck.mockRejectedValue(new Error('connection lost'))
    registerDbIpcHandlers()
    const handler = mockHandle.mock.calls.find((c) => c[0] === 'db:health')?.[1]
    const result = await handler({})
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining('connection lost') })
  })
})
