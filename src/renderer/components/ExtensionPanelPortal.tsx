import React, { useEffect, useRef, useState } from 'react'
import { useShownExtensionViews } from '../stores/shown-extension-views.store'
import { useModalStore } from '../stores/modal.store'
import { useExtensionRegistry } from '../extensions/registry'
import { createDoubleEscapeDetector } from '../../shared/double-escape'
import { FRAME_PORT_MESSAGE } from '../../shared/frame-wire'
import { focusActiveTerminal } from '../lib/focus-terminal'

interface Props {
  extensionId: string
  viewParam: string
  isActive: boolean
  repoRoot?: string | null
  /** ext:// URL of the extension's renderer entry point; the desktop frame's src. */
  rendererUrl?: string
}

type Surface = Pick<Props, 'extensionId' | 'viewParam'>

// True only in the real Electron renderer — the remote shim omits openFramePort.
function isDesktop(): boolean {
  return typeof window.electronAPI?.extension?.openFramePort === 'function'
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
function frameSrc(props: Props): string {
  const { extensionId, viewParam, repoRoot } = props
  const params = new URLSearchParams({ viewParam })
  if (repoRoot) params.set('repoRoot', repoRoot)
  return `/ext/${extensionId}/?${params.toString()}`
}

/** Desktop src: the extension's own ext:// URL, shaped as ExtensionViewHost.buildUrl shapes it. */
function desktopFrameSrc(props: Props): string {
  const { extensionId, viewParam, repoRoot, rendererUrl } = props
  const url = new URL(rendererUrl ?? `ext://${extensionId}/index.html`)
  if (viewParam) url.searchParams.set('view', viewParam)
  if (repoRoot) url.searchParams.set('repoRoot', repoRoot)
  return url.toString()
}

/** Marks the extension's view on screen while it is, so the core leaves its toasts to it. */
function useShownWhileVisible({ extensionId, viewParam }: Surface, visible: boolean): void {
  useEffect(() => {
    if (!visible) return
    const viewKey = `${extensionId}:${viewParam}`
    const { show, hide } = useShownExtensionViews.getState()
    show(viewKey, extensionId)
    return () => hide(viewKey)
  }, [extensionId, viewParam, visible])
}

/** Browser clients have no preload, so the host page listens on the same-origin frame. */
function useDoubleEscapeInFrame(
  iframeRef: React.RefObject<HTMLIFrameElement>,
  { extensionId, viewParam }: Surface,
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) return
    const iframe = iframeRef.current
    if (!iframe) return
    return listenInFrame(iframe, doubleEscapeListener({ extensionId, viewParam }))
  }, [iframeRef, extensionId, viewParam, enabled])
}

/** Forwards main's port reply to the frame whose current token it carries. */
function useFramePortForward(
  iframeRef: React.RefObject<HTMLIFrameElement>,
  extensionId: Props['extensionId'],
  tokenRef: React.MutableRefObject<string | null>
): void {
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== window || event.data?.type !== FRAME_PORT_MESSAGE) return
      if (event.data.frameToken !== tokenRef.current) return
      iframeRef.current?.contentWindow?.postMessage(
        { type: FRAME_PORT_MESSAGE },
        `ext://${extensionId}`,
        [event.ports[0]]
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [iframeRef, extensionId, tokenRef])
}

interface FrameHandshake extends Surface {
  iframeRef: React.RefObject<HTMLIFrameElement>
  tokenRef: React.MutableRefObject<string | null>
  onFirstLoad: () => void
}

/** Asks main for the frame's port on every load; a stale token from an earlier load is ignored. */
function useFrameHandshake(handshake: FrameHandshake): void {
  const { iframeRef, tokenRef, onFirstLoad, extensionId, viewParam } = handshake
  const onLoadRef = useRef(onFirstLoad)
  useEffect(() => {
    onLoadRef.current = onFirstLoad
  }, [onFirstLoad])
  useEffect(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    const onLoad = (): void => {
      onLoadRef.current()
      const frameToken = crypto.randomUUID()
      tokenRef.current = frameToken
      window.electronAPI.extension.openFramePort({ extensionId, viewParam, frameToken })
    }
    iframe.addEventListener('load', onLoad)
    return () => iframe.removeEventListener('load', onLoad)
  }, [iframeRef, tokenRef, extensionId, viewParam])
}

/** A reloaded extension's backend is new, so the frame's port to the old one is dead: the frame
 * reloads, and its next load asks main for a port to the new backend. */
function useReloadOnExtensionReload(
  iframeRef: React.RefObject<HTMLIFrameElement>,
  extensionId: Props['extensionId'],
  enabled: boolean
): void {
  useEffect(() => {
    if (!enabled) return
    return window.electronAPI.extensionEvents.onExtensionRendererReload((reloaded) => {
      const iframe = iframeRef.current
      // The frame is cross-origin, so its own `location` is out of reach; setting `src` again reloads it.
      if (reloaded === extensionId && iframe) iframe.setAttribute('src', iframe.src)
    })
  }, [iframeRef, extensionId, enabled])
}

/** Wires the desktop port handshake: asks main on each frame load, forwards the reply. */
function useFramePort(
  props: Props,
  iframeRef: React.RefObject<HTMLIFrameElement>,
  onFirstLoad: () => void
): void {
  const tokenRef = useRef<string | null>(null)
  useFramePortForward(iframeRef, props.extensionId, tokenRef)
  useReloadOnExtensionReload(iframeRef, props.extensionId, isDesktop())
  useFrameHandshake({
    iframeRef,
    tokenRef,
    extensionId: props.extensionId,
    viewParam: props.viewParam,
    onFirstLoad,
  })
}

function panelStyle(isActive: boolean): React.CSSProperties {
  return {
    flex: 1,
    minHeight: 0,
    minWidth: 0,
    display: isActive ? 'flex' : 'none',
    flexDirection: 'column',
    position: 'relative',
  }
}

const IFRAME_STYLE: React.CSSProperties = { flex: 1, border: 'none', width: '100%', minHeight: 0 }

/** Under an open modal the frame stays painted beneath the backdrop but takes no input. The modal
 * makes the page around it inert, yet the browser has routed a click on the modal into the
 * out-of-process frame below it; inert and pointer-events on the iframe itself keep it out. */
function frameInputProps(modalOpen: boolean): React.IframeHTMLAttributes<HTMLIFrameElement> {
  if (!modalOpen) return { style: IFRAME_STYLE }
  // React 18 has no `inert` prop; an empty string renders the boolean attribute.
  return { style: { ...IFRAME_STYLE, pointerEvents: 'none' }, ...{ inert: '' } }
}

function LoadingOverlay(): JSX.Element {
  return (
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
  )
}

function ExtensionFrame(props: Props): JSX.Element {
  const { extensionId, viewParam, isActive } = props
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [loaded, setLoaded] = useState(false)
  const desktop = isDesktop()
  const modalOpen = useModalStore((s) => s.depth > 0)
  useShownWhileVisible({ extensionId, viewParam }, isActive)
  useFramePort(props, iframeRef, () => setLoaded(true))
  useDoubleEscapeInFrame(iframeRef, { extensionId, viewParam }, !desktop)

  return (
    <div
      data-extension-panel={extensionId}
      data-view-param={viewParam}
      style={panelStyle(isActive)}
    >
      <iframe
        ref={iframeRef}
        src={desktop ? desktopFrameSrc(props) : frameSrc(props)}
        {...frameInputProps(modalOpen)}
        allow="clipboard-read; clipboard-write"
      />
      {!loaded && <LoadingOverlay />}
    </div>
  )
}

export function ExtensionPanelPortal(props: Props): JSX.Element {
  return <ExtensionFrame {...props} />
}
