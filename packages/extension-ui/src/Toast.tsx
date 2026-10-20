import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { createPortal } from 'react-dom'
import { layerValue } from './layers'
import { useTopModal } from './modal-stack'
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
  useAutoDismiss(onDismiss, duration, tone)
  return (
    <div className="tmui-toast" data-tone={tone} role="status">
      <span className="tmui-toast__message">{message}</span>
      {action && <ToastAction action={action} onDismiss={onDismiss} />}
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

/** The toast's one action; once it has run the toast has nothing left to offer, so it closes. */
function ToastAction({
  action,
  onDismiss,
}: {
  action: NonNullable<ToastItem['action']>
  onDismiss: () => void
}): JSX.Element {
  const run = (): void => {
    action.onSelect()
    onDismiss()
  }
  return (
    <button type="button" className="tmui-toast__action" onClick={run}>
      {action.label}
    </button>
  )
}

/** Dismisses after the toast's duration; zero leaves it to the reader. */
function useAutoDismiss(
  onDismiss: () => void,
  duration: number | undefined,
  tone: ToastTone
): void {
  const dismissRef = useRef(onDismiss)
  useEffect(() => {
    dismissRef.current = onDismiss
  })

  useEffect(() => {
    const ms = duration ?? (tone === 'error' ? 0 : DEFAULT_DURATION_MS)
    if (ms <= 0) return
    const timer = setTimeout(() => dismissRef.current(), ms)
    return () => clearTimeout(timer)
  }, [duration, tone])
}

export interface ToastRegionProps {
  toasts: readonly ToastItem[]
  onDismiss: (id: string) => void
}

/** Mount once per view. Sits above every other layer. While a modal shell is open the region
 * renders inside the one on top: outside it, a toast would be inert and painted over. Its toasts
 * mount afresh on that move, so each one's time on screen starts again. */
export function ToastRegion({ toasts, onDismiss }: ToastRegionProps): JSX.Element | null {
  const modal = useTopModal()
  if (toasts.length === 0) return null
  const region = <ToastList toasts={toasts} onDismiss={onDismiss} />
  return modal ? createPortal(region, modal) : region
}

function ToastList({ toasts, onDismiss }: ToastRegionProps): JSX.Element {
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
