import React, { useEffect, useRef, useState } from 'react'

interface Props {
  extensionId: string
  viewParam: string
  isActive: boolean
}

export function ExtensionPanelPortal({ extensionId, viewParam, isActive }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const sendBounds = () => {
      const rect = el.getBoundingClientRect()
      window.electronAPI.extension.updatePanelBounds({
        extensionId,
        viewParam,
        bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        visible: isActive,
      })
    }
    const observer = new ResizeObserver(sendBounds)

    observer.observe(el)
    return () => {
      observer.disconnect()
      // Hide the WebContentsView when this portal unmounts so it doesn't
      // intercept pointer/drag events while the panel is closed.
      window.electronAPI?.extension?.updatePanelBounds({
        extensionId,
        viewParam,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
      })
    }
  }, [extensionId, viewParam, isActive])

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
