import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
  Notification: { isSupported: () => false },
  app: { dock: null },
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
      const result = await handler(null, { type: 'info', title: 'Hello' })
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'info', title: 'Hello' })
      )
      expect(result).toEqual({ id: 'new-id' })
    })

    it('returns VALIDATION_ERROR for missing title', async () => {
      const handler = captureHandle('notifications:create')
      const result = await handler(null, { type: 'info' })
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
      expect(mockCreate).not.toHaveBeenCalled()
    })

    it('returns VALIDATION_ERROR for invalid type', async () => {
      const handler = captureHandle('notifications:create')
      const result = await handler(null, { type: 'bad', title: 'T' })
      expect(result).toMatchObject({ error: 'VALIDATION_ERROR' })
    })

    it('passes optional targets to the manager', async () => {
      mockCreate.mockReturnValue('tid')
      const handler = captureHandle('notifications:create')
      await handler(null, { type: 'success', title: 'T', targets: ['system', 'toast'] })
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ targets: ['system', 'toast'] })
      )
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
