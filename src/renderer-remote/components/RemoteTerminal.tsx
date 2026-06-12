import React, { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { AttachAddon } from '@xterm/addon-attach'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getWsTicket, resizeTerminal } from '../api/remote-client'

interface RemoteTerminalProps {
  sessionId: string
  onClose?: () => void
}

export function RemoteTerminal({ sessionId, onClose }: RemoteTerminalProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({ theme: { background: '#1a1a1a', foreground: '#e0e0e0' } })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    let ws: WebSocket | null = null

    async function connect() {
      try {
        const ticket = await getWsTicket(sessionId)
        const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
        ws = new WebSocket(`${proto}//${location.host}/ws/terminals/${sessionId}?ticket=${ticket}`)
        const attachAddon = new AttachAddon(ws)
        term.loadAddon(attachAddon)

        ws.addEventListener('close', (ev) => {
          if (ev.code === 1000) onClose?.()
        })
      } catch (err) {
        term.write(`\r\nFailed to connect: ${String(err)}\r\n`)
      }
    }

    void connect()

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
      void resizeTerminal(sessionId, term.cols, term.rows)
    })
    if (containerRef.current) observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      ws?.close()
      term.dispose()
    }
  }, [sessionId, onClose])

  return <div ref={containerRef} style={{ flex: 1, minHeight: 0, background: '#1a1a1a' }} />
}
