import React, { useEffect, useRef, useState } from 'react'
import { useModalStore } from '../stores/modal.store'
import { useExtensionRegistry } from '../extensions/registry'
import { createDoubleEscapeDetector } from '../../shared/double-escape'
import { focusActiveTerminal } from '../lib/focus-terminal'

interface Props {
  extensionId: string
  viewParam: string
  isActive: boolean
  repoRoot?: string | null
}

type Surface = Pick<Props, 'extensionId' | 'viewParam'>

// True only in the real Electron renderer — the remote shim does not expose this.
function isElectronLocal(): boolean {
  return typeof window.electronAPI?.extensionEvents?.onExtensionPanelLoaded === 'function'
}

/** A second Escape leaves the surface for the terminal: a sidebar panel closes, a tab clears. */
function doubleEscapeListener({ extensionId, viewParam }: Surface): (e: KeyboardEvent) => void {
  const detector = createDoubleEscapeDetector()
  return (e) => {
    if (e.key !== 'Escape') return
    if (!detector.register(performance.now())) return
    const { sidebarPanels, exitExtensionToTerminal } = useExtensionRegistry.getState()
    const isSidebar = sidebarPanels.get(extensionId)?.view === viewParam
    if (exitExtensionToTerminal(isSidebar ? extensionId : undefined)) {
      setTimeout(focusActiveTerminal, 0)
    }
  }
}

/** Listens on the frame's window, and again on each new window a navigation brings. */
function listenInFrame(iframe: HTMLIFrameElement, listener: (e: KeyboardEvent) => void) {
  const attached = new Set<Window>()
  const attach = (): void => {
    const win = iframe.contentWindow
    if (!win || attached.has(win)) return
    win.addEventListener('keydown', listener)
    attached.add(win)
  }
  attach()
  iframe.addEventListener('load', attach)
  return () => {
    iframe.removeEventListener('load', attach)
    for (const win of attached) win.removeEventListener('keydown', listener)
  }
}

/** Where Remote Control serves the extension's view to a browser. */
function frameSrc({ extensionId, viewParam, repoRoot }: Props): string {
  const params = new URLSearchParams({ viewParam })
  if (repoRoot) params.set('repoRoot', repoRoot)
  return `/ext/${extensionId}/?${params.toString()}`
}

function RemoteIframe(props: Props): JSX.Element {
  const { extensionId, viewParam, isActive } = props
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const src = frameSrc(props)

  // Native panels get the double-Escape exit from the webview preload; browser
  // clients have no preload, so the host page listens on the same-origin frame.
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    return listenInFrame(iframe, doubleEscapeListener({ extensionId, viewParam }))
  }, [extensionId, viewParam])

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
        ref={iframeRef}
        src={src}
        style={{ flex: 1, border: 'none', width: '100%', minHeight: 0 }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  )
}

interface PanelPlacement extends Surface {
  visible: boolean
  repoRoot: string | null
}

function sendPanelBounds(el: HTMLElement, placement: PanelPlacement): void {
  const rect = el.getBoundingClientRect()
  window.electronAPI?.extension?.updatePanelBounds?.({
    ...placement,
    bounds: {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  })
}

/**
 * Keeps the extension's WebContentsView over the container: its bounds follow
 * every resize, and it hides while a modal is open or the panel is not active.
 */
function usePanelBounds(
  containerRef: React.RefObject<HTMLDivElement>,
  { extensionId, viewParam, isActive, repoRoot = null }: Props
): void {
  const modalOpen = useModalStore((s) => s.depth > 0)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const visible = isActive && !modalOpen
    const sendBounds = () => sendPanelBounds(el, { extensionId, viewParam, visible, repoRoot })
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
  }, [containerRef, extensionId, viewParam, isActive, repoRoot, modalOpen])
}

/** Whether the spinner shows: until main says the panel loaded, on a host that says so at all. */
function usePanelLoading(extensionId: string): boolean {
  const [loading, setLoading] = useState(true)
  const reportsLoaded =
    typeof window.electronAPI?.extensionEvents?.onExtensionPanelLoaded === 'function'

  useEffect(() => {
    if (!reportsLoaded) return
    const unsubscribe = window.electronAPI.extensionEvents.onExtensionPanelLoaded((id: string) => {
      if (id === extensionId) setLoading(false)
    })
    return unsubscribe
  }, [extensionId, reportsLoaded])
  return loading && reportsLoaded
}

function LocalWebContentsPortal(props: Props): JSX.Element {
  const { extensionId, viewParam } = props
  const containerRef = useRef<HTMLDivElement>(null)
  usePanelBounds(containerRef, props)
  const loading = usePanelLoading(extensionId)

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
