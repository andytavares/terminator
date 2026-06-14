import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock window.electronAPI so the notification store's dismiss calls don't throw
Object.defineProperty(globalThis, 'window', {
  value: { electronAPI: { notifications: { dismiss: vi.fn().mockResolvedValue({ ok: true }) } } },
  writable: true,
})

import { useToastStore } from '../../../../src/renderer/stores/toast.store'
import { useNotificationStore } from '../../../../src/renderer/stores/notification.store'

// Reset store state between tests
function resetStore() {
  useToastStore.setState({ toasts: [] })
  useNotificationStore.setState({ notifications: [], panelOpen: false, unreadCount: 0 })
}

describe('useToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    resetStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('addToast', () => {
    it('adds a toast with a unique id and specified type/message', () => {
      useToastStore.getState().addToast({ type: 'info', message: 'Hello' })
      const { toasts } = useToastStore.getState()
      expect(toasts).toHaveLength(1)
      expect(toasts[0].type).toBe('info')
      expect(toasts[0].message).toBe('Hello')
      expect(toasts[0].id).toBeTruthy()
    })

    it('defaults duration to 3500ms for non-error toasts', () => {
      useToastStore.getState().addToast({ type: 'success', message: 'Done' })
      const { toasts } = useToastStore.getState()
      expect(toasts[0].duration).toBe(3500)
    })

    it('defaults duration to 6000ms for error toasts', () => {
      useToastStore.getState().addToast({ type: 'error', message: 'Oops' })
      const { toasts } = useToastStore.getState()
      expect(toasts[0].duration).toBe(6000)
    })

    it('respects explicit duration override', () => {
      useToastStore.getState().addToast({ type: 'info', message: 'msg', duration: 1000 })
      expect(useToastStore.getState().toasts[0].duration).toBe(1000)
    })

    it('generates unique ids for multiple toasts', () => {
      useToastStore.getState().addToast({ type: 'info', message: 'A' })
      useToastStore.getState().addToast({ type: 'info', message: 'B' })
      const ids = useToastStore.getState().toasts.map((t) => t.id)
      expect(new Set(ids).size).toBe(2)
    })

    it('auto-removes toast after duration expires', () => {
      useToastStore.getState().addToast({ type: 'info', message: 'Temp', duration: 1000 })
      expect(useToastStore.getState().toasts).toHaveLength(1)
      vi.advanceTimersByTime(1000)
      expect(useToastStore.getState().toasts).toHaveLength(0)
    })

    it('does not remove other toasts when one expires', () => {
      useToastStore.getState().addToast({ type: 'info', message: 'A', duration: 1000 })
      useToastStore.getState().addToast({ type: 'info', message: 'B', duration: 5000 })
      vi.advanceTimersByTime(1000)
      const { toasts } = useToastStore.getState()
      expect(toasts).toHaveLength(1)
      expect(toasts[0].message).toBe('B')
    })

    it('does NOT add to the notification store (toasts are ephemeral)', () => {
      useToastStore.getState().addToast({ type: 'success', message: 'Saved' })
      const { notifications } = useNotificationStore.getState()
      expect(notifications).toHaveLength(0)
    })
  })

  describe('removeToast', () => {
    it('removes the toast with the given id', () => {
      useToastStore.getState().addToast({ type: 'warning', message: 'Watch out' })
      const { toasts } = useToastStore.getState()
      const { id } = toasts[0]
      useToastStore.getState().removeToast(id)
      expect(useToastStore.getState().toasts).toHaveLength(0)
    })

    it('does not remove other toasts', () => {
      useToastStore.getState().addToast({ type: 'info', message: 'Keep' })
      useToastStore.getState().addToast({ type: 'error', message: 'Remove' })
      const { toasts } = useToastStore.getState()
      const removeId = toasts[1].id
      useToastStore.getState().removeToast(removeId)
      expect(useToastStore.getState().toasts).toHaveLength(1)
      expect(useToastStore.getState().toasts[0].message).toBe('Keep')
    })

    it('is a no-op for unknown id', () => {
      useToastStore.getState().addToast({ type: 'info', message: 'Stays' })
      useToastStore.getState().removeToast('nonexistent-id')
      expect(useToastStore.getState().toasts).toHaveLength(1)
    })
  })
})
