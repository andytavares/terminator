import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockDismiss = vi.fn().mockResolvedValue({ ok: true })

Object.defineProperty(globalThis, 'window', {
  value: {
    electronAPI: {
      notifications: {
        dismiss: mockDismiss,
      },
    },
  },
  writable: true,
})

import { useNotificationStore } from '../../../../src/renderer/stores/notification.store'
import type { SerializedNotification } from '../../../../src/renderer/electron.d'

function makeNotif(overrides: Partial<SerializedNotification> = {}): SerializedNotification {
  return {
    id: crypto.randomUUID(),
    type: 'info',
    title: 'Test notification',
    timestamp: Date.now(),
    ...overrides,
  }
}

function resetStore() {
  useNotificationStore.setState({ notifications: [], panelOpen: false, unreadCount: 0 })
}

describe('useNotificationStore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStore()
  })

  describe('addNotification', () => {
    it('adds notification with read=false and increments unreadCount', () => {
      const n = makeNotif()
      useNotificationStore.getState().addNotification(n)
      const { notifications, unreadCount } = useNotificationStore.getState()
      expect(notifications).toHaveLength(1)
      expect(notifications[0].read).toBe(false)
      expect(notifications[0].title).toBe(n.title)
      expect(unreadCount).toBe(1)
    })

    it('is a no-op when same id is added twice', () => {
      const n = makeNotif({ id: 'dup-id' })
      useNotificationStore.getState().addNotification(n)
      useNotificationStore.getState().addNotification(n)
      expect(useNotificationStore.getState().notifications).toHaveLength(1)
      expect(useNotificationStore.getState().unreadCount).toBe(1)
    })

    it('prepends newest notification to front of list', () => {
      useNotificationStore.getState().addNotification(makeNotif({ id: 'first', title: 'A' }))
      useNotificationStore.getState().addNotification(makeNotif({ id: 'second', title: 'B' }))
      const { notifications } = useNotificationStore.getState()
      expect(notifications[0].title).toBe('B')
      expect(notifications[1].title).toBe('A')
    })
  })

  describe('markRead', () => {
    it('marks notification as read and decrements unreadCount', () => {
      const n = makeNotif()
      useNotificationStore.getState().addNotification(n)
      useNotificationStore.getState().markRead(n.id)
      const { notifications, unreadCount } = useNotificationStore.getState()
      expect(notifications[0].read).toBe(true)
      expect(unreadCount).toBe(0)
    })

    it('does not change other notifications', () => {
      const a = makeNotif({ id: 'a' })
      const b = makeNotif({ id: 'b' })
      useNotificationStore.getState().addNotification(a)
      useNotificationStore.getState().addNotification(b)
      useNotificationStore.getState().markRead(a.id)
      const { notifications } = useNotificationStore.getState()
      const bNotif = notifications.find((n) => n.id === 'b')
      expect(bNotif?.read).toBe(false)
    })
  })

  describe('markAllRead', () => {
    it('marks all notifications as read and zeroes unreadCount', () => {
      useNotificationStore.getState().addNotification(makeNotif({ id: 'x' }))
      useNotificationStore.getState().addNotification(makeNotif({ id: 'y' }))
      useNotificationStore.getState().markAllRead()
      const { notifications, unreadCount } = useNotificationStore.getState()
      expect(notifications.every((n) => n.read)).toBe(true)
      expect(unreadCount).toBe(0)
    })
  })

  describe('dismiss', () => {
    it('removes notification from list', () => {
      const n = makeNotif()
      useNotificationStore.getState().addNotification(n)
      useNotificationStore.getState().dismiss(n.id)
      expect(useNotificationStore.getState().notifications).toHaveLength(0)
    })

    it('calls electronAPI.notifications.dismiss with the id', () => {
      const n = makeNotif({ id: 'to-dismiss' })
      useNotificationStore.getState().addNotification(n)
      useNotificationStore.getState().dismiss(n.id)
      expect(mockDismiss).toHaveBeenCalledWith('to-dismiss')
    })

    it('updates unreadCount after dismissing unread notification', () => {
      const n = makeNotif()
      useNotificationStore.getState().addNotification(n)
      useNotificationStore.getState().dismiss(n.id)
      expect(useNotificationStore.getState().unreadCount).toBe(0)
    })
  })

  describe('clearAll', () => {
    it('empties notifications list and zeroes unreadCount', () => {
      useNotificationStore.getState().addNotification(makeNotif({ id: 'c1' }))
      useNotificationStore.getState().addNotification(makeNotif({ id: 'c2' }))
      useNotificationStore.getState().clearAll()
      expect(useNotificationStore.getState().notifications).toHaveLength(0)
      expect(useNotificationStore.getState().unreadCount).toBe(0)
    })

    it('calls dismiss on each notification', () => {
      useNotificationStore.getState().addNotification(makeNotif({ id: 'd1' }))
      useNotificationStore.getState().addNotification(makeNotif({ id: 'd2' }))
      useNotificationStore.getState().clearAll()
      expect(mockDismiss).toHaveBeenCalledTimes(2)
    })
  })

  describe('panel state', () => {
    it('togglePanel flips panelOpen', () => {
      expect(useNotificationStore.getState().panelOpen).toBe(false)
      useNotificationStore.getState().togglePanel()
      expect(useNotificationStore.getState().panelOpen).toBe(true)
      useNotificationStore.getState().togglePanel()
      expect(useNotificationStore.getState().panelOpen).toBe(false)
    })

    it('openPanel sets panelOpen to true', () => {
      useNotificationStore.getState().openPanel()
      expect(useNotificationStore.getState().panelOpen).toBe(true)
    })

    it('closePanel sets panelOpen to false', () => {
      useNotificationStore.getState().openPanel()
      useNotificationStore.getState().closePanel()
      expect(useNotificationStore.getState().panelOpen).toBe(false)
    })
  })
})
