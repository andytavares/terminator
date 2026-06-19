import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { AttachAddon } from '@xterm/addon-attach'
import { useReconnect } from '../hooks/useReconnect'
import { MobileControlToolbar } from './MobileControlToolbar'
import { getWsTicket, resizeTerminal } from '../api/remote-client'

interface Props {
  sessionId: string
  cwd: string
  onBack: () => void
}

export function MobileTerminalView({ sessionId, cwd, onBack }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
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
      const ticket = await getWsTicket(sessionId)
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(
        `${protocol}//${location.host}/ws/terminals/${sessionId}?ticket=${encodeURIComponent(ticket)}`
      )
      wsRef.current = socket
      setWs(socket)

      const attachAddon = new AttachAddon(socket)
      termRef.current?.loadAddon(attachAddon)
    } catch {
      // Notify the reconnect hook so it enters the retry loop immediately
      onOpenWsFailedRef.current?.()
    }
  }, [sessionId])

  const { status, retry, onOpenWsFailed } = useReconnect(openWs, ws)
  onOpenWsFailedRef.current = onOpenWsFailed

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

    term.onResize(({ cols, rows }) => {
      resizeTerminal(sessionId, cols, rows).catch(() => undefined)
    })

    openWs()

    return () => {
      ro.disconnect()
      wsRef.current?.close()
      term.dispose()
    }
  }, [sessionId, openWs])

  const handleKey = useCallback((seq: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(seq)
    }
  }, [])

  return (
    <div className="mobile-terminal-wrapper">
      <div className="mobile-terminal-header">
        <button className="mobile-terminal-header__back" aria-label="Back" onClick={onBack}>
          ←
        </button>
        <span className="mobile-terminal-header__title">{cwd}</span>
      </div>

      <div className="mobile-terminal-container" ref={containerRef} />

      {status === 'reconnecting' && <div className="mobile-terminal-status">Reconnecting…</div>}
      {status === 'disconnected' && (
        <div className="mobile-terminal-status mobile-terminal-status--error">
          Disconnected
          <button className="mobile-terminal-status__retry" onClick={retry}>
            Retry
          </button>
        </div>
      )}

      <MobileControlToolbar onKey={handleKey} />
    </div>
  )
}
