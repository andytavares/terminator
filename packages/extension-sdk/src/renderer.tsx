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

/** Opens an address in the person's browser: a view cannot open a window of its own. */
export function openInBrowser(url: string): void {
  window.electronAPI.shell.openExternal(url).catch(() => {})
}
