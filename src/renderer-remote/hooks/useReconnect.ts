import { useState, useEffect, useRef, useCallback } from 'react'

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  /** Turned away: the terminal already has as many viewers as the app allows. */
  | 'full'
  /** Disconnected from the desktop app's Remote Control view. */
  | 'removed'

// The codes the server closes a terminal socket with on purpose (terminal.routes.ts).
// Reconnecting by itself would undo the owner's decision, so only Retry does.
const DELIBERATE_CLOSES: Partial<Record<number, ConnectionStatus>> = {
  4003: 'full',
  4004: 'removed',
}

export function useReconnect(
  openWs: () => void,
  ws: WebSocket | null
): { status: ConnectionStatus; retry: () => void; onOpenWsFailed: () => void } {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    ws?.readyState === WebSocket.OPEN ? 'connected' : 'connecting'
  )
  const attemptsRef = useRef(0)
  const turnedAwayRef = useRef(false)
  const wsRef = useRef(ws)
  const openWsRef = useRef(openWs)

  useEffect(() => {
    wsRef.current = ws
  }, [ws])

  useEffect(() => {
    openWsRef.current = openWs
  }, [openWs])

  // A socket that is already open when it arrives is connected on that same render.
  const [previousWs, setPreviousWs] = useState(ws)
  if (ws !== previousWs) {
    setPreviousWs(ws)
    if (ws?.readyState === WebSocket.OPEN) setStatus('connected')
  }

  // Clear status as soon as the socket opens
  useEffect(() => {
    if (!ws) return
    if (ws.readyState === WebSocket.OPEN) attemptsRef.current = 0
    const handleOpen = () => {
      setStatus('connected')
      attemptsRef.current = 0
    }
    const handleClose = (event: CloseEvent) => {
      const why = DELIBERATE_CLOSES[event.code]
      if (!why) return
      turnedAwayRef.current = true
      setStatus(why)
    }
    ws.addEventListener?.('open', handleOpen)
    ws.addEventListener?.('close', handleClose)
    return () => {
      ws.removeEventListener?.('open', handleOpen)
      ws.removeEventListener?.('close', handleClose)
    }
  }, [ws])

  const attempt = useCallback(function attempt() {
    if (turnedAwayRef.current) return
    const state = wsRef.current?.readyState
    if (state === WebSocket.OPEN) {
      setStatus('connected')
      attemptsRef.current = 0
      return
    }
    if (attemptsRef.current >= 3) {
      setStatus('disconnected')
      return
    }
    attemptsRef.current += 1
    // If already CONNECTING, don't open another socket — just wait and count the attempt
    if (state !== WebSocket.CONNECTING) {
      openWsRef.current()
    }
    setStatus('reconnecting')
    setTimeout(attempt, 2000)
  }, [])

  // Called by openWs when a connection attempt fails (ticket fetch error, socket error, etc.)
  // so that the first failure immediately enters the reconnect loop rather than freezing.
  const onOpenWsFailed = useCallback(() => {
    if (attemptsRef.current < 3) {
      attemptsRef.current += 1
      setStatus('reconnecting')
      setTimeout(attempt, 2000)
    } else {
      setStatus('disconnected')
    }
  }, [attempt])

  const retry = useCallback(() => {
    attemptsRef.current = 0
    turnedAwayRef.current = false
    attempt()
  }, [attempt])

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        attemptsRef.current = 0
        attempt()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [attempt])

  return { status, retry, onOpenWsFailed }
}
