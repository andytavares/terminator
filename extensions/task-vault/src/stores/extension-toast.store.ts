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

/** Errors stay up longer than everything else. */
function defaultDuration(type: ToastType): number {
  if (type === 'error') return 6000
  return 3500
}

export const useExtensionToastStore = create<ExtensionToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const { type, message, onClick } = toast
    const duration = toast.duration ?? defaultDuration(type)
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
