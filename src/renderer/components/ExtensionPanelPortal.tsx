import React, { useEffect, useRef, useState } from 'react'
import { useModalStore } from '../stores/modal.store'

interface Props {
  extensionId: string
  viewParam: string
  isActive: boolean
  repoRoot?: string | null
}

export function ExtensionPanelPortal({
  extensionId,
  viewParam,
  isActive,
  repoRoot = null,
}: Props): JSX.Element {
  const modalOpen = useModalStore((s) => s.depth > 0)
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const sendBounds = () => {
      const rect = el.getBoundingClientRect()
      // Use window dimensions for width/height rather than rect.width/height.
      // The flex layout can report an intermediate (too-small) rect during
      // transitions; anchoring from rect.left to window.innerWidth ensures the
      // WebContentsView always covers the full available area.
      const x = Math.round(rect.left)
      const y = Math.round(rect.top)
      window.electronAPI.extension.updatePanelBounds({
        extensionId,
        viewParam,
        bounds: {
          x,
          y,
          width: Math.round(window.innerWidth - x),
          height: Math.round(window.innerHeight - y),
        },
        visible: isActive && !modalOpen,
        repoRoot,
      })
    }
    const observer = new ResizeObserver(sendBounds)

    observer.observe(el)
    // Explicit initial call so bounds are sent even if the element size doesn't
    // change between React commits (ResizeObserver fires async; this is sync).
    sendBounds()
    window.addEventListener('resize', sendBounds)
    // Re-send after the sidebar CSS transition (200ms) to pick up the final
    // layout after any width animation.
    const timer = setTimeout(sendBounds, 250)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sendBounds)
      clearTimeout(timer)
      // Hide the WebContentsView when this portal unmounts so it doesn't
      // intercept pointer/drag events while the panel is closed.
      window.electronAPI?.extension?.updatePanelBounds({
        extensionId,
        viewParam,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
        repoRoot: null,
      })
    }
  }, [extensionId, viewParam, isActive, repoRoot, modalOpen])

  useEffect(() => {
    const unsubscribe = window.electronAPI.extensionEvents.onExtensionPanelLoaded((id: string) => {
      if (id === extensionId) setLoading(false)
    })
    return unsubscribe
  }, [extensionId])

  return (
    <div
      ref={containerRef}
      data-extension-panel={extensionId}
      data-view-param={viewParam}
      style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative' }}
    >
      {loading && (
        <div
          data-testid="extension-loading"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div className="activity-spinner" />
        </div>
      )}
    </div>
  )
}
