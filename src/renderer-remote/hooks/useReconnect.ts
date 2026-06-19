import { useState, useEffect, useRef, useCallback } from 'react'

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

export function useReconnect(
  openWs: () => void,
  ws: WebSocket | null
): { status: ConnectionStatus; retry: () => void } {
  const [status, setStatus] = useState<ConnectionStatus>('connected')
  const attemptsRef = useRef(0)
  const wsRef = useRef(ws)
  const openWsRef = useRef(openWs)

  useEffect(() => {
    wsRef.current = ws
  }, [ws])

  useEffect(() => {
    openWsRef.current = openWs
  }, [openWs])

  const attempt = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setStatus('connected')
      attemptsRef.current = 0
      return
    }
    if (attemptsRef.current >= 3) {
      setStatus('disconnected')
      return
    }
    attemptsRef.current += 1
    openWsRef.current()
    setStatus('reconnecting')
    setTimeout(attempt, 2000)
  }, [])

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

  return { status, retry }
}
