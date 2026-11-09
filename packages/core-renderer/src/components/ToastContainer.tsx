import type { JSX } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ToastRegion } from '@terminator/extension-ui'
import { useToastStore } from '../stores/toast.store'
import { openBugReport } from '../stores/bug-report.store'

/** An error toast with nothing else to offer offers a bug report about it (ADR 156). A window
 * without bug reports (the remote) offers none. */
function reportAction(type: string, message: string) {
  if (type !== 'error' || window.electronAPI?.bugReport?.capture === undefined) return undefined
  return { label: 'Report', onSelect: () => openBugReport(`The app said: ${message}\n\n`) }
}

/** The core's toast store, drawn by the design system's toast region. */
export function ToastContainer(): JSX.Element | null {
  const { toasts, removeToast } = useToastStore(
    useShallow((s) => ({ toasts: s.toasts, removeToast: s.removeToast }))
  )
  return (
    <ToastRegion
      // The store expires each toast itself, so the region keeps no timer of its own.
      toasts={toasts.map(({ id, message, type, action }) => ({
        id,
        message,
        tone: type,
        duration: 0,
        action: action ?? reportAction(type, message),
      }))}
      onDismiss={removeToast}
    />
  )
}
