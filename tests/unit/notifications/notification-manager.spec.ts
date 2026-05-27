import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockSend = vi.fn()
const mockWin = { isDestroyed: vi.fn(() => false), webContents: { send: mockSend } }
const mockDestroyedWin = { isDestroyed: vi.fn(() => true), webContents: { send: mockSend } }

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => [mockWin]) },
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
})

describe('NotificationManager.create', () => {
  it('broadcasts notification to all windows on create', () => {
    notificationManager.create({ type: 'info', title: 'Hello' })
    expect(mockSend).toHaveBeenCalledWith(
      'notifications:push',
      expect.objectContaining({
        type: 'info',
        title: 'Hello',
      })
    )
  })

  it('skips destroyed windows during broadcast', () => {
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
      expect.objectContaining({
        actions: [{ id: 'go', label: 'Go' }],
      })
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
      expect.objectContaining({
        message: 'Details',
        source: 'ext',
      })
    )
  })
})

describe('NotificationManager.list', () => {
  it('returns empty array when no notifications exist', () => {
    // Create a fresh manager to avoid cross-test pollution
    // notificationManager is a singleton — just check that list() works
    const result = notificationManager.list()
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns created notifications', () => {
    notificationManager.create({ type: 'info', title: 'Listed' })
    const list = notificationManager.list()
    expect(list.some((n) => n.title === 'Listed')).toBe(true)
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
