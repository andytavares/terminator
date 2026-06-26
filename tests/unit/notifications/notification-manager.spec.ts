import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockNotificationShow, mockNotificationOn, MockNotification, mockDockBounce, mockSend } =
  vi.hoisted(() => {
    const mockNotificationShow = vi.fn()
    const mockNotificationOn = vi.fn()
    const MockNotification = vi.fn().mockImplementation(function () {
      return { show: mockNotificationShow, on: mockNotificationOn }
    })
    Object.assign(MockNotification, { isSupported: vi.fn(() => true) })
    const mockDockBounce = vi.fn()
    const mockSend = vi.fn()
    return { mockNotificationShow, mockNotificationOn, MockNotification, mockDockBounce, mockSend }
  })

const mockWin = { isDestroyed: vi.fn(() => false), webContents: { send: mockSend } }
const mockDestroyedWin = { isDestroyed: vi.fn(() => true), webContents: { send: mockSend } }

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [mockWin]) },
  Notification: MockNotification,
  app: { dock: { bounce: mockDockBounce } },
}))

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}))

import { notificationManager } from '../../../src/main/notifications/notification-manager'
import { BrowserWindow } from 'electron'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin] as unknown as ReturnType<
    typeof BrowserWindow.getAllWindows
  >)
  MockNotification.isSupported.mockReturnValue(true)
})

describe('NotificationManager.create — targets', () => {
  it('defaults to all three targets', () => {
    notificationManager.create({ type: 'info', title: 'Hello' })
    expect(MockNotification).toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ targets: ['system', 'center', 'toast'] })
    )
  })

  it('fires system notification when targets includes system', () => {
    notificationManager.create({ type: 'info', title: 'Sys', targets: ['system'] })
    expect(MockNotification).toHaveBeenCalledWith({ title: 'Sys', body: '' })
    expect(mockNotificationShow).toHaveBeenCalled()
  })

  it('does not fire system notification when targets omits system', () => {
    notificationManager.create({ type: 'info', title: 'No sys', targets: ['center', 'toast'] })
    expect(MockNotification).not.toHaveBeenCalled()
  })

  it('does not broadcast when targets is only system', () => {
    notificationManager.create({ type: 'info', title: 'Only sys', targets: ['system'] })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('broadcasts when targets includes center', () => {
    notificationManager.create({ type: 'info', title: 'Center only', targets: ['center'] })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ targets: ['center'] })
    )
  })

  it('broadcasts when targets includes toast', () => {
    notificationManager.create({ type: 'info', title: 'Toast only', targets: ['toast'] })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ targets: ['toast'] })
    )
  })

  it('skips system notification when not supported', () => {
    MockNotification.isSupported.mockReturnValue(false)
    notificationManager.create({ type: 'info', title: 'No support' })
    expect(mockNotificationShow).not.toHaveBeenCalled()
  })

  it('bounces dock critically on macOS when system notification fires', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    notificationManager.create({ type: 'info', title: 'Bounce', targets: ['system'] })
    expect(mockDockBounce).toHaveBeenCalledWith('critical')
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('registers a failed handler on the system notification', () => {
    notificationManager.create({ type: 'info', title: 'Sys', targets: ['system'] })
    expect(mockNotificationOn).toHaveBeenCalledWith('failed', expect.any(Function))
  })
})

describe('NotificationManager.create — broadcast', () => {
  it('broadcasts notification to all windows on create', () => {
    notificationManager.create({ type: 'info', title: 'Hello' })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ type: 'info', title: 'Hello' })
    )
  })

  it('skips destroyed windows during broadcast', () => {
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      mockDestroyedWin,
    ] as unknown as ReturnType<typeof BrowserWindow.getAllWindows>)
    notificationManager.create({ type: 'info', title: 'Skip me', targets: ['center'] })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('includes actions in serialized notification', () => {
    notificationManager.create({
      type: 'warning',
      title: 'With action',
      actions: [{ id: 'go', label: 'Go', handler: vi.fn() }],
    })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ actions: [{ id: 'go', label: 'Go' }] })
    )
  })

  it('omits actions field when no actions provided', () => {
    notificationManager.create({ type: 'success', title: 'No actions' })
    const payload = mockSend.mock.calls[0][1] as { actions?: unknown }
    expect(payload.actions).toBeUndefined()
  })

  it('includes optional message and source', () => {
    notificationManager.create({ type: 'error', title: 'Err', message: 'Details', source: 'ext' })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ message: 'Details', source: 'ext' })
    )
  })
})

describe('NotificationManager.list', () => {
  it('returns empty array when no notifications exist', () => {
    const result = notificationManager.list()
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns created notifications', () => {
    notificationManager.create({ type: 'info', title: 'Listed' })
    const list = notificationManager.list()
    expect(list.some((n) => n.title === 'Listed')).toBe(true)
  })

  it('does not store system-only notifications in the list', () => {
    notificationManager.create({ type: 'info', title: 'Bell', targets: ['system'] })
    const list = notificationManager.list()
    expect(list.some((n) => n.title === 'Bell')).toBe(false)
  })

  it('stores a center-only notification in the list', () => {
    notificationManager.create({ type: 'info', title: 'Center', targets: ['center'] })
    expect(notificationManager.list().some((n) => n.title === 'Center')).toBe(true)
  })

  it('stores a toast-only notification in the list', () => {
    notificationManager.create({ type: 'info', title: 'Toast', targets: ['toast'] })
    expect(notificationManager.list().some((n) => n.title === 'Toast')).toBe(true)
  })
})

describe('NotificationManager.dismiss', () => {
  it('removes the notification so it no longer appears in list', () => {
    const id = notificationManager.create({ type: 'info', title: 'To dismiss' })
    notificationManager.dismiss(id)
    expect(notificationManager.list().some((n) => n.id === id)).toBe(false)
  })
})

describe('NotificationManager.triggerAction', () => {
  it('returns UNKNOWN_NOTIFICATION for a missing id', () => {
    const result = notificationManager.triggerAction('no-such-id', 'action')
    expect(result).toEqual({ error: 'UNKNOWN_NOTIFICATION' })
  })

  it('returns UNKNOWN_ACTION when action id does not match', () => {
    const id = notificationManager.create({
      type: 'info',
      title: 'Has action',
      actions: [{ id: 'real-action', label: 'Real', handler: vi.fn() }],
    })
    const result = notificationManager.triggerAction(id, 'wrong-action')
    expect(result).toEqual({ error: 'UNKNOWN_ACTION' })
  })

  it('calls the handler and returns ok:true', () => {
    const handler = vi.fn()
    const id = notificationManager.create({
      type: 'info',
      title: 'Actionable',
      actions: [{ id: 'do-it', label: 'Do it', handler }],
    })
    const result = notificationManager.triggerAction(id, 'do-it')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })
})
