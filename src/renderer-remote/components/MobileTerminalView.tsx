import React, { useEffect, useRef, useState, useCallback, type MutableRefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { useReconnect, type ConnectionStatus } from '../hooks/useReconnect'
import { MobileControlToolbar } from './MobileControlToolbar'
import { getWsTicket, resizeTerminal } from '../api/remote-client'

interface Props {
  sessionId: string
  cwd: string
  onBack: () => void
}

type SocketRef = MutableRefObject<WebSocket | null>
type TerminalRef = MutableRefObject<Terminal | null>

export function MobileTerminalView({ sessionId, cwd, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const { status, retry, openWs } = useTerminalSocket(sessionId, wsRef, termRef)
  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data)
    }
  }, [])
  const close = useCallback(() => wsRef.current?.close(), [])
  useMobileTerminal(containerRef, { sessionId, openWs, send, close, termRef })

  return (
    <div className="mobile-terminal-wrapper">
      <div className="mobile-terminal-header">
        <button className="mobile-terminal-header__back" aria-label="Back" onClick={onBack}>
          ←
        </button>
        <span className="mobile-terminal-header__title">{cwd}</span>
      </div>

      <div className="mobile-terminal-container" ref={containerRef} />

      <ConnectionStatusBanner status={status} retry={retry} />

      <MobileControlToolbar onKey={send} />
    </div>
  )
}

/** The session's socket, opened again through useReconnect whenever it drops. */
function useTerminalSocket(sessionId: string, wsRef: SocketRef, termRef: TerminalRef) {
  const [ws, setWs] = useState<WebSocket | null>(null)
  // onOpenWsFailed is populated once useReconnect runs; stable via ref to avoid circular deps
  const onOpenWsFailedRef = useRef<(() => void) | null>(null)

  const openWs = useCallback(async () => {
    // Tear down any existing socket before opening a new one to prevent stacking connections
    const prev = wsRef.current
    if (prev && prev.readyState !== WebSocket.CLOSED) {
      prev.close()
    }
    try {
      const socket = await connectTerminalSocket(sessionId, termRef)
      wsRef.current = socket
      setWs(socket)
    } catch {
      // Notify the reconnect hook so it enters the retry loop immediately
      onOpenWsFailedRef.current?.()
    }
  }, [sessionId, wsRef, termRef])

  const { status, retry, onOpenWsFailed } = useReconnect(openWs, ws)
  useEffect(() => {
    onOpenWsFailedRef.current = onOpenWsFailed
  }, [onOpenWsFailed])
  return { status, retry, openWs }
}

async function connectTerminalSocket(sessionId: string, termRef: TerminalRef): Promise<WebSocket> {
  const ticket = await getWsTicket(sessionId)
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const socket = new WebSocket(
    `${protocol}//${location.host}/ws/terminals/${sessionId}?ticket=${encodeURIComponent(ticket)}`
  )
  socket.addEventListener('message', (event) => {
    if (termRef.current) writeKeepingScroll(termRef.current, event.data)
  })
  return socket
}

/** Writes output without pulling a reader who has scrolled up back to the bottom. */
function writeKeepingScroll(term: Terminal, payload: string | ArrayBuffer): void {
  const { baseY, length } = term.buffer.active
  const atBottom = baseY + term.rows >= length
  const data = typeof payload === 'string' ? payload : new Uint8Array(payload)
  term.write(data, () => {
    if (!atBottom) {
      term.scrollToLine(baseY)
    }
  })
}

interface MobileTerminal {
  sessionId: string
  openWs: () => Promise<void>
  /** Sends to the socket if it is open; drops the data otherwise. */
  send: (data: string) => void
  close: () => void
  termRef: TerminalRef
}

/** Mounts xterm in the container, fitted to it, wired to the socket, and opens the socket. */
function useMobileTerminal(
  containerRef: React.RefObject<HTMLDivElement>,
  { sessionId, openWs, send, close, termRef }: MobileTerminal
): void {
  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({ fontSize: 14, fontFamily: 'IBM Plex Mono, monospace' })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()
    termRef.current = term

    const ro = new ResizeObserver(() => fitAddon.fit())
    ro.observe(containerRef.current)

    term.onData(send)

    term.onResize(({ cols, rows }) => {
      resizeTerminal(sessionId, cols, rows).catch(() => undefined)
    })

    openWs()

    return () => {
      ro.disconnect()
      close()
      term.dispose()
    }
  }, [sessionId, openWs, send, close, containerRef, termRef])
}

/** Why the connection ended, for each way it can end that waits on the person. */
const ENDED: Partial<Record<ConnectionStatus, string>> = {
  disconnected: 'Disconnected',
  full: 'This terminal already has as many viewers as allowed. Retry once one leaves.',
  removed: 'The desktop app disconnected this device.',
}

function ConnectionStatusBanner({
  status,
  retry,
}: {
  status: ConnectionStatus
  retry: () => void
}): JSX.Element | null {
  if (status === 'reconnecting') {
    return <div className="mobile-terminal-status">Reconnecting…</div>
  }
  const message = ENDED[status]
  if (!message) return null
  return (
    <div className="mobile-terminal-status mobile-terminal-status--error" role="alert">
      {message}
      <button className="mobile-terminal-status__retry" onClick={retry}>
        Retry
      </button>
    </div>
  )
}
