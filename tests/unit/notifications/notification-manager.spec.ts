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

const mockGetGlobalSettings = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [mockWin]) },
  Notification: MockNotification,
  app: { dock: { bounce: mockDockBounce } },
}))

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}))

vi.mock('../../../src/main/storage/settings-store', () => ({
  getGlobalSettings: mockGetGlobalSettings,
}))

import { notificationManager } from '../../../src/main/notifications/notification-manager'
import { BrowserWindow } from 'electron'

function withDefaultTargets(...defaultTargets: Array<'system' | 'center' | 'toast'>): void {
  mockGetGlobalSettings.mockReturnValue({
    notifications: { defaultTargets, extensionOverrides: {} },
  })
}

function withExtensionOverride(
  extensionId: string,
  overrideTargets: Array<'system' | 'center' | 'toast'>,
  defaultTargets: Array<'system' | 'center' | 'toast'> = ['toast']
): void {
  mockGetGlobalSettings.mockReturnValue({
    notifications: { defaultTargets, extensionOverrides: { [extensionId]: overrideTargets } },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([mockWin] as unknown as ReturnType<
    typeof BrowserWindow.getAllWindows
  >)
  MockNotification.isSupported.mockReturnValue(true)
  withDefaultTargets('system', 'center', 'toast')
})

describe('NotificationManager.create — settings-driven target resolution', () => {
  it('resolves the global default targets when the caller has no source', () => {
    withDefaultTargets('toast')
    notificationManager.create({ type: 'info', title: 'Hello' })
    expect(MockNotification).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ targets: ['toast'] })
    )
  })

  it('prefers a per-extension override over the global default', () => {
    withExtensionOverride('terminator.git-integration', ['system'])
    notificationManager.create({
      type: 'info',
      title: 'From extension',
      source: 'terminator.git-integration',
    })
    expect(MockNotification).toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('falls back to the global default for a source with no override', () => {
    withExtensionOverride('terminator.git-integration', ['system'], ['toast'])
    notificationManager.create({
      type: 'info',
      title: 'From other ext',
      source: 'terminator.other',
    })
    expect(MockNotification).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ targets: ['toast'] })
    )
  })

  it('force-includes toast for an error even when settings omit it', () => {
    withDefaultTargets('system')
    notificationManager.create({ type: 'error', title: 'Uh oh' })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ targets: ['system', 'toast'] })
    )
  })

  it('fires system notification when resolved targets include system', () => {
    withDefaultTargets('system')
    notificationManager.create({ type: 'info', title: 'Sys' })
    expect(MockNotification).toHaveBeenCalledWith({ title: 'Sys', body: '' })
    expect(mockNotificationShow).toHaveBeenCalled()
  })

  it('does not fire system notification when resolved targets omit system', () => {
    withDefaultTargets('center', 'toast')
    notificationManager.create({ type: 'info', title: 'No sys' })
    expect(MockNotification).not.toHaveBeenCalled()
  })

  it('does not broadcast when resolved targets is only system', () => {
    withDefaultTargets('system')
    notificationManager.create({ type: 'info', title: 'Only sys' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('broadcasts when resolved targets includes center', () => {
    withDefaultTargets('center')
    notificationManager.create({ type: 'info', title: 'Center only' })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ targets: ['center'] })
    )
  })

  it('broadcasts when resolved targets includes toast', () => {
    withDefaultTargets('toast')
    notificationManager.create({ type: 'info', title: 'Toast only' })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({ targets: ['toast'] })
    )
  })

  it('skips system notification when not supported', () => {
    withDefaultTargets('system')
    MockNotification.isSupported.mockReturnValue(false)
    notificationManager.create({ type: 'info', title: 'No support' })
    expect(mockNotificationShow).not.toHaveBeenCalled()
  })

  it('bounces dock critically on macOS when system notification fires', () => {
    withDefaultTargets('system')
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    notificationManager.create({ type: 'info', title: 'Bounce' })
    expect(mockDockBounce).toHaveBeenCalledWith('critical')
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('registers a failed handler on the system notification', () => {
    withDefaultTargets('system')
    notificationManager.create({ type: 'info', title: 'Sys' })
    expect(mockNotificationOn).toHaveBeenCalledWith('failed', expect.any(Function))
  })

  it('wires the first action handler to the system notification click event', () => {
    withDefaultTargets('system')
    const handler = vi.fn()
    notificationManager.create({
      type: 'info',
      title: 'Clickable',
      actions: [{ id: 'open', label: 'Open', handler }],
    })
    expect(mockNotificationOn).toHaveBeenCalledWith('click', expect.any(Function))
    const clickHandler = mockNotificationOn.mock.calls.find((c) => c[0] === 'click')![1]
    clickHandler()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not wire a click handler when there are no actions', () => {
    withDefaultTargets('system')
    notificationManager.create({ type: 'info', title: 'No actions' })
    expect(mockNotificationOn).not.toHaveBeenCalledWith('click', expect.any(Function))
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
    withDefaultTargets('center')
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      mockDestroyedWin,
    ] as unknown as ReturnType<typeof BrowserWindow.getAllWindows>)
    notificationManager.create({ type: 'info', title: 'Skip me' })
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
    withDefaultTargets('system')
    notificationManager.create({ type: 'info', title: 'Bell' })
    const list = notificationManager.list()
    expect(list.some((n) => n.title === 'Bell')).toBe(false)
  })

  it('stores a center-only notification in the list', () => {
    withDefaultTargets('center')
    notificationManager.create({ type: 'info', title: 'Center' })
    expect(notificationManager.list().some((n) => n.title === 'Center')).toBe(true)
  })

  it('stores a toast-only notification in the list', () => {
    withDefaultTargets('toast')
    notificationManager.create({ type: 'info', title: 'Toast' })
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
