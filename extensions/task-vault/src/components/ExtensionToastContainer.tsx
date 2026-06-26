import React from 'react'
import { useExtensionToastStore } from '../stores/extension-toast.store'

const ICONS: Record<string, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
}

export function ExtensionToastContainer(): React.JSX.Element {
  const { toasts, removeToast } = useExtensionToastStore()

  return (
    <div className="ext-toast-container" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`ext-toast ext-toast--${toast.type}`}
          role="alert"
          onClick={toast.onClick}
          style={toast.onClick ? { cursor: 'pointer' } : undefined}
        >
          <span className="ext-toast__icon">{ICONS[toast.type]}</span>
          <span className="ext-toast__message">{toast.message}</span>
          <button
            className="ext-toast__close"
            onClick={(e) => {
              e.stopPropagation()
              removeToast(toast.id)
            }}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
