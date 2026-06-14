import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
  id: string
  type: ToastType
  message: string
  duration: number
  onClick?: () => void
}

interface ToastState {
  toasts: Toast[]
  addToast: (opts: {
    type: ToastType
    message: string
    duration?: number
    onClick?: () => void
  }) => void
  removeToast: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
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
