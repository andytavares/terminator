import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockOn = vi.fn()
const mockHandle = vi.fn()
const mockIsSupported = vi.fn().mockReturnValue(true)
const mockNotificationShow = vi.fn()
const MockNotification = vi.fn().mockImplementation(() => ({ show: mockNotificationShow }))
Object.assign(MockNotification, { isSupported: mockIsSupported })

const mockDockBounce = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { on: mockOn, handle: mockHandle },
  Notification: MockNotification,
  app: { dock: { bounce: mockDockBounce } },
}))

vi.mock('../../../src/main/notifications/notification-manager', () => ({
  notificationManager: { list: vi.fn(), dismiss: vi.fn(), triggerAction: vi.fn() },
}))

describe('registerNotificationHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsSupported.mockReturnValue(true)
    mockOn.mockImplementation((_ch: string, fn: (...args: unknown[]) => unknown) => fn)
  })

  it('registers notification:show listener', async () => {
    vi.resetModules()
    const { registerNotificationHandlers } = await import(
      '../../../src/main/ipc/notification.ipc.js'
    )
    registerNotificationHandlers()
    expect(mockOn).toHaveBeenCalledWith('notification:show', expect.any(Function))
  })

  it('shows a Notification when supported', async () => {
    vi.resetModules()
    const { registerNotificationHandlers } = await import(
      '../../../src/main/ipc/notification.ipc.js'
    )
    registerNotificationHandlers()
    const handler = mockOn.mock.calls.find(([ch]) => ch === 'notification:show')![1]
    handler(null, { title: 'Test', body: 'Hello' })
    expect(MockNotification).toHaveBeenCalledWith({ title: 'Test', body: 'Hello' })
    expect(mockNotificationShow).toHaveBeenCalled()
  })

  it('does not create Notification when not supported', async () => {
    mockIsSupported.mockReturnValue(false)
    vi.resetModules()
    const { registerNotificationHandlers } = await import(
      '../../../src/main/ipc/notification.ipc.js'
    )
    registerNotificationHandlers()
    const handler = mockOn.mock.calls.find(([ch]) => ch === 'notification:show')![1]
    handler(null, { title: 'T', body: 'B' })
    expect(mockNotificationShow).not.toHaveBeenCalled()
  })

  it('bounces dock on macOS', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    vi.resetModules()
    const { registerNotificationHandlers } = await import(
      '../../../src/main/ipc/notification.ipc.js'
    )
    registerNotificationHandlers()
    const handler = mockOn.mock.calls.find(([ch]) => ch === 'notification:show')![1]
    handler(null, { title: 'T', body: 'B' })
    expect(mockDockBounce).toHaveBeenCalledWith('informational')
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('does not bounce dock on non-macOS', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    vi.resetModules()
    const { registerNotificationHandlers } = await import(
      '../../../src/main/ipc/notification.ipc.js'
    )
    registerNotificationHandlers()
    const handler = mockOn.mock.calls.find(([ch]) => ch === 'notification:show')![1]
    handler(null, { title: 'T', body: 'B' })
    expect(mockDockBounce).not.toHaveBeenCalled()
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })
})
