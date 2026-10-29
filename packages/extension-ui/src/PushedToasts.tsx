import React, { useEffect, useState } from 'react'
import { ToastRegion, type ToastTone } from './Toast'
import { createToastStore } from './toast-store'

/** The part of a notification the dispatcher pushes that decides whether a view draws it. */
export interface PushedNotice {
  type: ToastTone
  title: string
  message?: string
  source?: string
  targets: string[]
}

export interface PushedToastsProps {
  /** The extension's id: the dispatcher tags each notification with the one that raised it. */
  source: string
  /** `window.electronAPI.notifications.onPush`, or anything shaped like it. */
  subscribe: (listener: (n: PushedNotice) => void) => () => void
}

/** Draws the extension's own notifications that go to a toast. While its view is on screen the
 * core leaves these to it, since the core's toast would sit under the view. */
export function PushedToasts({ source, subscribe }: PushedToastsProps): React.JSX.Element | null {
  const [useStore] = useState(createToastStore)
  const { toasts, removeToast } = useStore()
  useEffect(
    () =>
      subscribe((n) => {
        if (n.source !== source || !n.targets.includes('toast')) return
        const message = n.message ? `${n.title}: ${n.message}` : n.title
        useStore.getState().addToast({ type: n.type, message })
      }),
    [source, subscribe, useStore]
  )
  return (
    <ToastRegion
      // The store expires each toast itself, so the region keeps no timer of its own.
      toasts={toasts.map(({ id, message, type }) => ({ id, message, tone: type, duration: 0 }))}
      onDismiss={removeToast}
    />
  )
}
