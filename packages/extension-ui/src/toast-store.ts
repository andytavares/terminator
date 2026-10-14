import { create } from 'zustand'
import type { ToastTone } from './Toast'

export interface QueuedToast {
  id: string
  type: ToastTone
  message: string
  duration: number
  onClick?: () => void
}

export interface ToastQueue {
  toasts: QueuedToast[]
  addToast: (opts: {
    type: ToastTone
    message: string
    duration?: number
    onClick?: () => void
  }) => void
  removeToast: (id: string) => void
}

/** A view's queue of toasts, as a store any of its modules can add to. Each toast leaves on its
 * own: an error after 6 s, anything else after 3.5 s. */
export function createToastStore() {
  return create<ToastQueue>((set) => ({
    toasts: [],

    addToast: ({ type, message, duration = type === 'error' ? 6000 : 3500, onClick }) => {
      const id = crypto.randomUUID()
      set((s) => ({ toasts: [...s.toasts, { id, type, message, duration, onClick }] }))
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
      }, duration)
    },

    removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  }))
}
