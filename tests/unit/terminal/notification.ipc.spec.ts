import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
const mockCreate = vi.fn(() => 'test-uuid')

const mockGetAllWindows = vi.fn(() => [])

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
  BrowserWindow: { getAllWindows: mockGetAllWindows },
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
    const result = await handler(null, { type: 'info', title: 'Hello', key: 'helloKey' })
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'info', title: 'Hello', key: 'helloKey' })
    )
    expect(result).toEqual({ id: 'test-uuid' })
  })

  it('ignores a caller-supplied targets field (delivery is settings-resolved, not caller-supplied)', async () => {
    const handler = captureHandle('notifications:create')
    await handler(null, {
      type: 'success',
      title: 'T',
      key: 'tKey',
      targets: ['system', 'toast'],
    })
    expect(mockCreate).toHaveBeenCalledWith({ type: 'success', title: 'T', key: 'tKey' })
  })

  it('passes an optional source through so per-extension overrides can resolve', async () => {
    const handler = captureHandle('notifications:create')
    await handler(null, {
      type: 'info',
      title: 'T',
      key: 'tKey',
      source: 'terminator.task-vault',
    })
    expect(mockCreate).toHaveBeenCalledWith({
      type: 'info',
      title: 'T',
      key: 'tKey',
      source: 'terminator.task-vault',
    })
  })

  it('returns VALIDATION_ERROR for invalid type', async () => {
    const handler = captureHandle('notifications:create')
    const result = await handler(null, { type: 'bad', title: 'T', key: 'tKey' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns VALIDATION_ERROR for missing title', async () => {
    const handler = captureHandle('notifications:create')
    const result = await handler(null, { type: 'info', key: 'tKey' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
  })

  it('returns VALIDATION_ERROR for missing key', async () => {
    const handler = captureHandle('notifications:create')
    const result = await handler(null, { type: 'info', title: 'T' })
    expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('sends terminal:navigate-to-session to every window when the onClick from a sessionId fires', async () => {
    const handler = captureHandle('notifications:create')
    const win = {
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { isDestroyed: () => false, send: vi.fn() },
    }
    mockGetAllWindows.mockReturnValue([win] as unknown as [])
    await handler(null, { type: 'info', title: 'T', key: 'tKey', sessionId: 'ses-1' })
    const passed = mockCreate.mock.calls[0][0] as { onClick?: () => void }
    expect(passed.onClick).toEqual(expect.any(Function))
    passed.onClick!()
    expect(win.webContents.send).toHaveBeenCalledWith('terminal:navigate-to-session', {
      sessionId: 'ses-1',
    })
  })

  it('restores a minimized window and skips a destroyed one when revealing a session', async () => {
    const handler = captureHandle('notifications:create')
    const minimized = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { isDestroyed: () => false, send: vi.fn() },
    }
    const destroyed = { ...minimized, isDestroyed: () => true, restore: vi.fn(), show: vi.fn() }
    mockGetAllWindows.mockReturnValue([destroyed, minimized] as unknown as [])
    await handler(null, { type: 'info', title: 'T', key: 'tKey', sessionId: 'ses-2' })
    const passed = mockCreate.mock.calls[0][0] as { onClick?: () => void }
    passed.onClick!()
    expect(minimized.restore).toHaveBeenCalled()
    expect(minimized.focus).toHaveBeenCalled()
    expect(destroyed.show).not.toHaveBeenCalled()
  })
})
