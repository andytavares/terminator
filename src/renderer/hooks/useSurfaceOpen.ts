import { useSyncExternalStore } from 'react'
import { isSurfaceOpen } from '@shared/double-escape'

/** A dialog opening or closing changes its `open` attribute or the tree; a popover only fires
 * `toggle`, which does not bubble, so it is heard in the capture phase. */
function subscribe(notify: () => void): () => void {
  const observer = new MutationObserver(notify)
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open'],
  })
  document.addEventListener('toggle', notify, true)
  return () => {
    observer.disconnect()
    document.removeEventListener('toggle', notify, true)
  }
}

/** Whether a modal dialog or a popover is open in this window, read from the DOM. */
export function useSurfaceOpen(): boolean {
  return useSyncExternalStore(subscribe, () => isSurfaceOpen(document))
}
