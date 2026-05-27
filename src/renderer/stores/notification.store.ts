import { create } from 'zustand'
import type { SerializedNotification } from '../electron.d'

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
  clearAll(): void
  openPanel(): void
  closePanel(): void
  togglePanel(): void
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  panelOpen: false,
  unreadCount: 0,

  addNotification(n) {
    if (get().notifications.some((existing) => existing.id === n.id)) return
    const { onClick, ...rest } = n
    const notification: Notification = { ...rest, read: false, onClick }
    set((s) => ({
      notifications: [notification, ...s.notifications],
      unreadCount: s.unreadCount + 1,
    }))
  },

  markRead(id) {
    set((s) => {
      const notifications = s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n))
      return { notifications, unreadCount: notifications.filter((n) => !n.read).length }
    })
  },

  markAllRead() {
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
      unreadCount: 0,
    }))
  },

  dismiss(id) {
    set((s) => {
      const notifications = s.notifications.filter((n) => n.id !== id)
      return { notifications, unreadCount: notifications.filter((n) => !n.read).length }
    })
    void window.electronAPI.notifications.dismiss(id)
  },

  clearAll() {
    const { notifications } = get()
    notifications.forEach((n) => {
      void window.electronAPI.notifications.dismiss(n.id)
    })
    set({ notifications: [], unreadCount: 0 })
  },

  openPanel() {
    set({ panelOpen: true })
  },

  closePanel() {
    set({ panelOpen: false })
  },

  togglePanel() {
    set((s) => ({ panelOpen: !s.panelOpen }))
  },
}))
