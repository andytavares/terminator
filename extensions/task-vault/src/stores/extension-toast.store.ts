import { create } from 'zustand'

export type ToastType = 'info' | 'success' | 'warning' | 'error'

export interface ExtensionToast {
  id: string
  type: ToastType
  message: string
  duration: number
  onClick?: () => void
}

interface ExtensionToastState {
  toasts: ExtensionToast[]
  addToast: (opts: {
    type: ToastType
    message: string
    duration?: number
    onClick?: () => void
  }) => void
  removeToast: (id: string) => void
}

export const useExtensionToastStore = create<ExtensionToastState>((set) => ({
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

export function addExtensionToast(
  type: ToastType,
  message: string,
  opts?: { onClick?: () => void; duration?: number }
): void {
  useExtensionToastStore.getState().addToast({ type, message, ...opts })
}
