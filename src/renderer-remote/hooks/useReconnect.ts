import { useState, useEffect, useRef, useCallback } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

export function useReconnect(
  openWs: () => void,
  ws: WebSocket | null
): { status: ConnectionStatus; retry: () => void; onOpenWsFailed: () => void } {
  const [status, setStatus] = useState<ConnectionStatus>('connecting')
  const attemptsRef = useRef(0)
  const wsRef = useRef(ws)
  const openWsRef = useRef(openWs)

  useEffect(() => {
    wsRef.current = ws
  }, [ws])

  useEffect(() => {
    openWsRef.current = openWs
  }, [openWs])

  // Clear status as soon as the socket opens
  useEffect(() => {
    if (!ws) return
    if (ws.readyState === WebSocket.OPEN) {
      setStatus('connected')
      attemptsRef.current = 0
    }
    const handleOpen = () => {
      setStatus('connected')
      attemptsRef.current = 0
    }
    ws.addEventListener?.('open', handleOpen)
    return () => ws.removeEventListener?.('open', handleOpen)
  }, [ws])

  const attempt = useCallback(() => {
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
