import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'

/** Calls one of this extension's own channels. The handler owns the result shape, so the caller
 * states it. A call without a payload sends `{}`, which is also what the remote bridge sends in
 * its place. */
export function invoke<T = unknown>(channel: string, payload: unknown = {}): Promise<T> {
  return window.electronAPI.extensionBridge.invoke(channel, payload) as Promise<T>
}

/** Renders an extension view into the `#app` element of its `index.html`. */
export function mountExtension(view: ReactElement): void {
  const element = document.getElementById('app')
  if (!element) throw new Error('No #app element')
  createRoot(element).render(view)
}

/** Opens an address in the person's browser: a view cannot open a window of its own. Settles
 * when the open has, whether or not it succeeded. */
export function openInBrowser(url: string): Promise<void> {
  return window.electronAPI.shell.openExternal(url).then(
    () => {},
    () => {}
  )
}

/** The view's `usage` member (types/renderer.d.ts). Named here, not imported: importing that
 * file declares its window type, which would replace the core's where both are compiled. */
interface UsageWindow {
  electronAPI: { usage: { record(feature: string, outcome?: { failed?: boolean }): void } }
}

/** Counts one use of `feature`, an id from this extension's `contributes.usage`; the core adds the
 * extension id. Since 6.1.0. */
export function recordUsage(feature: string, outcome?: { failed?: boolean }): void {
  const { usage } = (window as unknown as UsageWindow).electronAPI
  if (outcome) usage.record(feature, outcome)
  else usage.record(feature)
}
