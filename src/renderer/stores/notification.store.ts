import { create, type StoreApi } from 'zustand'
import type { SerializedNotification } from '../../shared/types/index'

export interface Notification extends SerializedNotification {
  read: boolean
  onClick?: () => void
}

interface NotificationState {
  notifications: Notification[]
  panelOpen: boolean
  unreadCount: number
  addNotification(n: SerializedNotification & { onClick?: () => void }): void
  markRead(id: string): void
  markAllRead(): void
  dismiss(id: string): void
  /**
   * Drops the row without telling main to forget it.
   *
   * For a notification main has already dropped itself — triggering an action
   * settles it there — where `dismiss` would ask it to forget an id it no
   * longer has.
   */
  remove(id: string): void
  clearAll(): void
  openPanel(): void
  closePanel(): void
  togglePanel(): void
}

/** The notifications with the unread count that agrees with them. */
const withUnreadCount = (notifications: Notification[]) => ({
  notifications,
  unreadCount: notifications.filter((n) => !n.read).length,
})

type SetNotifications = StoreApi<NotificationState>['setState']

/** A new notification first and unread, unless one with its id is already listed. */
function withNotification(
  s: NotificationState,
  n: SerializedNotification & { onClick?: () => void }
): Partial<NotificationState> {
  if (s.notifications.some((existing) => existing.id === n.id)) return s
  const { onClick, ...rest } = n
  const notification: Notification = { ...rest, read: false, onClick }
  return {
    notifications: [notification, ...s.notifications],
    unreadCount: s.unreadCount + 1,
  }
}

function readSlice(
  set: SetNotifications
): Pick<NotificationState, 'addNotification' | 'markRead' | 'markAllRead'> {
  return {
    addNotification: (n) => set((s) => withNotification(s, n)),
    markRead: (id) =>
      set((s) =>
        withUnreadCount(s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)))
      ),
    markAllRead: () =>
      set((s) => ({
        notifications: s.notifications.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      })),
  }
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  panelOpen: false,
  unreadCount: 0,
  ...readSlice(set),

  dismiss(id) {
    get().remove(id)
    void window.electronAPI.notifications.dismiss(id)
  },

  remove(id) {
    set((s) => withUnreadCount(s.notifications.filter((n) => n.id !== id)))
  },

  clearAll() {
    for (const n of get().notifications) void window.electronAPI.notifications.dismiss(n.id)
    set({ notifications: [], unreadCount: 0 })
  },

  openPanel: () => set({ panelOpen: true }),
  closePanel: () => set({ panelOpen: false }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
}))
