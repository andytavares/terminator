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

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect) return
      window.electronAPI.extension.updatePanelBounds({
        extensionId,
        viewParam,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: isActive,
        dpr: window.devicePixelRatio,
      })
    })

    observer.observe(el)
    return () => observer.disconnect()
  }, [extensionId, viewParam, isActive])

  useEffect(() => {
    const unsubscribe = window.electronAPI.extensionEvents.onExtensionPanelLoaded((id: string) => {
      if (id === extensionId) setLoading(false)
    })
    return unsubscribe
  }, [extensionId])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative' }}>
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
