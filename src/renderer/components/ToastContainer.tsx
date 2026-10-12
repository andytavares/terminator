import { ToastRegion } from '@terminator/extension-ui'
import { useToastStore } from '../stores/toast.store'

/** The core's toast store, drawn by the design system's toast region. */
export function ToastContainer(): JSX.Element | null {
  const { toasts, removeToast } = useToastStore()
  return (
    <ToastRegion
      // The store expires each toast itself, so the region keeps no timer of its own.
      toasts={toasts.map(({ id, message, type }) => ({ id, message, tone: type, duration: 0 }))}
      onDismiss={removeToast}
    />
  )
}
