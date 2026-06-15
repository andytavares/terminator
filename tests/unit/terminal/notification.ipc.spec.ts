import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
const mockCreate = vi.fn(() => 'test-uuid')

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

vi.mock('../../../src/main/notifications/notification-manager', () => ({
  notificationManager: {
    list: vi.fn(),
    dismiss: vi.fn(),
    triggerAction: vi.fn(),
    create: mockCreate,
  },
}))

function captureHandle(channel: string): (event: unknown, payload?: unknown) => unknown {
  const match = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

describe('registerNotificationHandlers', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    vi.resetModules()
    const { registerNotificationHandlers } = await import(
      '../../../src/main/ipc/notification.ipc.js'
    )
    registerNotificationHandlers()
  })

  it('does not register a notification:show listener (removed)', () => {
    const showCall = mockHandle.mock.calls.find(([ch]) => ch === 'notification:show')
    expect(showCall).toBeUndefined()
  })

  it('registers notifications:create handler', () => {
    expect(mockHandle).toHaveBeenCalledWith('notifications:create', expect.any(Function))
  })

  it('creates a notification and returns its id', async () => {
    const handler = captureHandle('notifications:create')
    const result = await handler(null, { type: 'info', title: 'Hello' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', title: 'Hello' })
    )
    expect(result).toEqual({ id: 'test-uuid' })
  })

  it('passes targets through to notificationManager.create', async () => {
    const handler = captureHandle('notifications:create')
    await handler(null, { type: 'success', title: 'T', targets: ['system', 'toast'] })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ targets: ['system', 'toast'] })
    )
  })

  it('returns VALIDATION_ERROR for invalid type', async () => {
    const handler = captureHandle('notifications:create')
    const result = await handler(null, { type: 'bad', title: 'T' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR for missing title', async () => {
    const handler = captureHandle('notifications:create')
    const result = await handler(null, { type: 'info' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns VALIDATION_ERROR for invalid target value', async () => {
    const handler = captureHandle('notifications:create')
    const result = await handler(null, { type: 'info', title: 'T', targets: ['unknown'] })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })
})
