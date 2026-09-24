import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain, BrowserWindow } from 'electron'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  Notification: { isSupported: () => false },
  app: { dock: null },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

const { mockList, mockDismiss, mockTriggerAction, mockCreate } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockDismiss: vi.fn(),
  mockTriggerAction: vi.fn(),
  mockCreate: vi.fn(),
}))

vi.mock('../../../src/main/notifications/notification-manager', () => ({
  notificationManager: {
    list: mockList,
    dismiss: mockDismiss,
    triggerAction: mockTriggerAction,
    create: mockCreate,
  },
}))

import { registerNotificationHandlers } from '../../../src/main/ipc/notification.ipc'

function captureHandle(channel: string): (event: unknown, payload?: unknown) => unknown {
  const calls = vi.mocked(ipcMain.handle).mock.calls
  const match = calls.find(([ch]) => ch === channel)
  if (!match) throw new Error(`No handler registered for: ${channel}`)
  return match[1] as (event: unknown, payload?: unknown) => unknown
}

describe('notification IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registerNotificationHandlers()
  })

  describe('notifications:create', () => {
    it('calls notificationManager.create and returns the id', async () => {
      mockCreate.mockReturnValue('new-id')
      const handler = captureHandle('notifications:create')
      const result = await handler(null, { type: 'info', title: 'Hello', key: 'helloKey' })
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info', title: 'Hello', key: 'helloKey' })
      )
      expect(result).toEqual({ id: 'new-id' })
    })

    it('returns VALIDATION_ERROR for missing title', async () => {
      const handler = captureHandle('notifications:create')
      const result = await handler(null, { type: 'info', key: 'tKey' })
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('returns VALIDATION_ERROR for missing key', async () => {
      const handler = captureHandle('notifications:create')
      const result = await handler(null, { type: 'info', title: 'T' })
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('returns VALIDATION_ERROR for invalid type', async () => {
      const handler = captureHandle('notifications:create')
      const result = await handler(null, { type: 'bad', title: 'T', key: 'tKey' })
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
    })

    it('ignores a caller-supplied targets field (delivery is settings-resolved, not caller-supplied)', async () => {
      mockCreate.mockReturnValue('tid')
      const handler = captureHandle('notifications:create')
      await handler(null, {
        type: 'success',
        title: 'T',
        key: 'tKey',
        targets: ['system', 'toast'],
      })
      expect(mockCreate).toHaveBeenCalledWith({ type: 'success', title: 'T', key: 'tKey' })
    })

    it('omits onClick when no sessionId is given', async () => {
      mockCreate.mockReturnValue('tid')
      const handler = captureHandle('notifications:create')
      await handler(null, { type: 'info', title: 'T', key: 'tKey' })
      expect(mockCreate).toHaveBeenCalledWith({ type: 'info', title: 'T', key: 'tKey' })
    })

    it('passes an onClick that shows, focuses and navigates every window when sessionId is given', async () => {
      mockCreate.mockReturnValue('sid')
      const win = {
        isDestroyed: () => false,
        isMinimized: () => false,
        restore: vi.fn(),
        show: vi.fn(),
        focus: vi.fn(),
        webContents: { isDestroyed: () => false, send: vi.fn() },
      }
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win] as unknown as ReturnType<
        typeof BrowserWindow.getAllWindows
      >)
      const handler = captureHandle('notifications:create')
      await handler(null, { type: 'info', title: 'T', key: 'tKey', sessionId: 'ses-1' })
      const passed = mockCreate.mock.calls[0][0] as { onClick?: () => void }
      expect(passed).toEqual({
        type: 'info',
        title: 'T',
        key: 'tKey',
        onClick: expect.any(Function),
      })
      passed.onClick!()
      expect(win.show).toHaveBeenCalled()
      expect(win.focus).toHaveBeenCalled()
      expect(win.webContents.send).toHaveBeenCalledWith('terminal:navigate-to-session', {
        sessionId: 'ses-1',
      })
    })
  })

  describe('notifications:list', () => {
    it('returns serialized notification list', async () => {
      const notifications = [{ id: '1', type: 'info', title: 'Hello', timestamp: 123 }]
      mockList.mockReturnValue(notifications)
      const handler = captureHandle('notifications:list')
      const result = await handler(null)
      expect(result).toEqual(notifications)
      expect(mockList).toHaveBeenCalled()
    })
  })

  describe('notifications:dismiss', () => {
    it('calls notificationManager.dismiss with id and returns ok', async () => {
      const handler = captureHandle('notifications:dismiss')
      const result = await handler(null, { id: 'notif-123' })
      expect(mockDismiss).toHaveBeenCalledWith('notif-123')
      expect(result).toEqual({ ok: true })
    })

    it('returns VALIDATION_ERROR for missing id', async () => {
      const handler = captureHandle('notifications:dismiss')
      const result = await handler(null, {})
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
      expect(mockDismiss).not.toHaveBeenCalled()
    })

    it('returns VALIDATION_ERROR for empty id', async () => {
      const handler = captureHandle('notifications:dismiss')
      const result = await handler(null, { id: '' })
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
    })
  })

  describe('notifications:trigger-action', () => {
    it('calls triggerAction and returns result', async () => {
      mockTriggerAction.mockReturnValue({ ok: true })
      const handler = captureHandle('notifications:trigger-action')
      const result = await handler(null, { notifId: 'n1', actionId: 'go' })
      expect(mockTriggerAction).toHaveBeenCalledWith('n1', 'go')
      expect(result).toEqual({ ok: true })
    })

    it('propagates UNKNOWN_NOTIFICATION from manager', async () => {
      mockTriggerAction.mockReturnValue({ error: 'UNKNOWN_NOTIFICATION' })
      const handler = captureHandle('notifications:trigger-action')
      const result = await handler(null, { notifId: 'bad', actionId: 'go' })
      expect(result).toEqual({ error: 'UNKNOWN_NOTIFICATION' })
    })

    it('returns VALIDATION_ERROR for missing notifId', async () => {
      const handler = captureHandle('notifications:trigger-action')
      const result = await handler(null, { actionId: 'go' })
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
      expect(mockTriggerAction).not.toHaveBeenCalled()
    })

    it('returns VALIDATION_ERROR for missing actionId', async () => {
      const handler = captureHandle('notifications:trigger-action')
      const result = await handler(null, { notifId: 'n1' })
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
      expect(mockTriggerAction).not.toHaveBeenCalled()
    })
  })
})
