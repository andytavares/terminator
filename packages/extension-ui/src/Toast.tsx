import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { layerValue } from './layers'
import './extension-ui.css'

/** Matches the core's existing ToastType, so migrating its store is not an API change. */
export type ToastTone = 'info' | 'success' | 'warning' | 'error'

export interface ToastItem {
  id: string
  message: string
  tone?: ToastTone
  /** Milliseconds. An error is sticky by default — it is the one you must read.
   *  Zero means the caller owns dismissal. */
  duration?: number
  /**
   * Somewhere to go from here.
   *
   * A named button, not a click target on the whole toast: an affordance the
   * reader cannot see is one they will not use, and one they will trigger by
   * accident reaching for the dismiss.
   */
  action?: { label: string; onSelect: () => void }
}

const DEFAULT_DURATION_MS = 5000

export interface ToastProps extends Omit<ToastItem, 'id'> {
  onDismiss: () => void
}

/**
 * A transient message.
 *
 * `role="status"` announces politely and never takes focus, which is what lets
 * a toast appear over an open dialog without interrupting it.
 */
export function Toast({
  message,
  tone = 'info',
  duration,
  action,
  onDismiss,
}: ToastProps): JSX.Element {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    const ms = duration ?? (tone === 'error' ? 0 : DEFAULT_DURATION_MS)
    if (ms <= 0) return
    const timer = setTimeout(() => dismissRef.current(), ms)
    return () => clearTimeout(timer)
  }, [duration, tone])

  return (
    <div className="tmui-toast" data-tone={tone} role="status">
      <span className="tmui-toast__message">{message}</span>
      {action && (
        <button type="button" className="tmui-toast__action" onClick={action.onSelect}>
          {action.label}
        </button>
      )}
      <button
        type="button"
        className="tmui-icon-button tmui-toast__dismiss"
        aria-label="Dismiss"
        title="Dismiss"
        onClick={onDismiss}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  )
}

export interface ToastRegionProps {
  toasts: readonly ToastItem[]
  onDismiss: (id: string) => void
}

/** Mount once per view. Sits above every other layer, including modals. */
export function ToastRegion({ toasts, onDismiss }: ToastRegionProps): JSX.Element | null {
  if (toasts.length === 0) return null
  return (
    <div className="tmui-toast-region" style={{ zIndex: layerValue('toast') }}>
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          duration={toast.duration}
          action={toast.action}
          onDismiss={() => onDismiss(toast.id)}
        />
      ))}
    </div>
  )
}
