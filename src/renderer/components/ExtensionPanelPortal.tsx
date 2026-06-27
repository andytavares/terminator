import React, { useEffect, useRef, useState } from 'react'
import { useModalStore } from '../stores/modal.store'

interface Props {
  extensionId: string
  viewParam: string
  isActive: boolean
  repoRoot?: string | null
}

// True only in the real Electron renderer — the remote shim does not expose this.
function isElectronLocal(): boolean {
  return typeof window.electronAPI?.extensionEvents?.onExtensionPanelLoaded === 'function'
}

function RemoteIframe({ extensionId, viewParam, repoRoot, isActive }: Props): JSX.Element {
  const params = new URLSearchParams({ viewParam })
  if (repoRoot) params.set('repoRoot', repoRoot)
  const src = `/ext/${extensionId}/?${params.toString()}`

  return (
    <div
      data-extension-panel={extensionId}
      data-view-param={viewParam}
      style={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: isActive ? 'flex' : 'none',
        flexDirection: 'column',
      }}
    >
      <iframe
        src={src}
        style={{ flex: 1, border: 'none', width: '100%', minHeight: 0 }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  )
}

function LocalWebContentsPortal({
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
      const x = Math.round(rect.left)
      const y = Math.round(rect.top)
      window.electronAPI?.extension?.updatePanelBounds?.({
        extensionId,
        viewParam,
        bounds: {
          x,
          y,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        visible: isActive && !modalOpen,
        repoRoot,
      })
    }
    const observer = new ResizeObserver(sendBounds)
    observer.observe(el)
    sendBounds()
    window.addEventListener('resize', sendBounds)
    const timer = setTimeout(sendBounds, 250)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', sendBounds)
      clearTimeout(timer)
      window.electronAPI?.extension?.updatePanelBounds?.({
        extensionId,
        viewParam,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        visible: false,
        repoRoot: null,
      })
    }
  }, [extensionId, viewParam, isActive, repoRoot, modalOpen])

  useEffect(() => {
    if (typeof window.electronAPI?.extensionEvents?.onExtensionPanelLoaded !== 'function') {
      setLoading(false)
      return
    }
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

export function ExtensionPanelPortal(props: Props): JSX.Element {
  if (isElectronLocal()) {
    return <LocalWebContentsPortal {...props} />
  }
  return <RemoteIframe {...props} />
}
