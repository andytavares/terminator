import { useEffect, useState } from 'react'

/** The content width of the element `paneRef` is set on, kept current by a ResizeObserver;
 *  null until the first measurement. */
export function usePaneWidth() {
  const [pane, setPane] = useState<HTMLElement | null>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    if (!pane) return undefined
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(pane)
    return () => observer.disconnect()
  }, [pane])
  return { paneRef: setPane, width }
}
