import { createToastStore, type ToastTone } from '@terminator/extension-ui'

export type ToastType = ToastTone

export const useExtensionToastStore = createToastStore()

export function addExtensionToast(
  type: ToastType,
  message: string,
  opts?: { onClick?: () => void; duration?: number }
): void {
  useExtensionToastStore.getState().addToast({ type, message, ...opts })
}
