import { useSyncExternalStore } from 'react'
import { isSurfaceOpen } from '../../shared/double-escape'

// One watcher for every pane: terminal output changes the tree often, and each pane querying the
// DOM on every batch cost one query per pane. The answer is computed once per batch and shared.
const listeners = new Set<() => void>()
let open = false
let stopWatching: (() => void) | null = null

function recompute(): void {
  const now = isSurfaceOpen(document)
  if (now === open) return
  open = now
  for (const notify of listeners) notify()
}

/** A dialog opening or closing changes its `open` attribute or the tree (one unmounted while open
 * fires no event); a popover only fires `toggle`, which does not bubble, so it is heard in capture. */
function watch(): () => void {
  const observer = new MutationObserver(recompute)
  const options = { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] }
  observer.observe(document.body, options)
  document.addEventListener('toggle', recompute, true)
  return () => {
    observer.disconnect()
    document.removeEventListener('toggle', recompute, true)
  }
}

function subscribe(notify: () => void): () => void {
  if (listeners.size === 0) {
    open = isSurfaceOpen(document)
    stopWatching = watch()
  }
  listeners.add(notify)
  return () => {
    listeners.delete(notify)
    if (listeners.size > 0) return
    stopWatching?.()
    stopWatching = null
  }
}

/** Whether a modal dialog or a popover is open in this window, read from the DOM. */
export function useSurfaceOpen(): boolean {
  return useSyncExternalStore(subscribe, () => open)
}
