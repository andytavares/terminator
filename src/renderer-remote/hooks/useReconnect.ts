import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react'

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 2000

interface Loop {
  wsRef: MutableRefObject<WebSocket | null>
  openWsRef: MutableRefObject<() => void>
  attemptsRef: MutableRefObject<number>
  setStatus: (status: ConnectionStatus) => void
}

export function useReconnect(
  openWs: () => void,
  ws: WebSocket | null
): { status: ConnectionStatus; retry: () => void; onOpenWsFailed: () => void } {
  const [status, setStatus] = useState<ConnectionStatus>(() =>
    ws?.readyState === WebSocket.OPEN ? 'connected' : 'connecting'
  )
  const attemptsRef = useRef(0)
  const wsRef = useRef(ws)
  const openWsRef = useRef(openWs)

  useEffect(() => {
    wsRef.current = ws
  }, [ws])

  useEffect(() => {
    openWsRef.current = openWs
  }, [openWs])

  useConnectedWhenOpen(ws, setStatus, attemptsRef)
  const loop = { wsRef, openWsRef, attemptsRef, setStatus }
  const attempt = useAttempt(loop)
  const onOpenWsFailed = useOnOpenWsFailed(attempt, loop)
  const retry = useCallback(() => {
    attemptsRef.current = 0
    attempt()
  }, [attempt])
  useAttemptWhenVisible(wsRef, attemptsRef, attempt)
  return { status, retry, onOpenWsFailed }
}

/** Connected as soon as the socket opens, or on the render it arrives already open. */
function useConnectedWhenOpen(
  ws: WebSocket | null,
  setStatus: Loop['setStatus'],
  attemptsRef: Loop['attemptsRef']
): void {
  const [previousWs, setPreviousWs] = useState(ws)
  if (ws !== previousWs) {
    setPreviousWs(ws)
    if (ws?.readyState === WebSocket.OPEN) setStatus('connected')
  }

  useEffect(() => {
    if (!ws) return
    if (ws.readyState === WebSocket.OPEN) attemptsRef.current = 0
    const handleOpen = () => {
      setStatus('connected')
      attemptsRef.current = 0
    }
    ws.addEventListener?.('open', handleOpen)
    return () => ws.removeEventListener?.('open', handleOpen)
  }, [ws, setStatus, attemptsRef])
}

/** Up to three attempts, two seconds apart, then disconnected until a retry. */
function useAttempt({ wsRef, openWsRef, attemptsRef, setStatus }: Loop): () => void {
  const attempt = useCallback(
    function attempt() {
      const state = wsRef.current?.readyState
      if (state === WebSocket.OPEN) {
        setStatus('connected')
        attemptsRef.current = 0
      } else if (attemptsRef.current >= MAX_ATTEMPTS) {
        setStatus('disconnected')
      } else {
        attemptsRef.current += 1
        // If already CONNECTING, don't open another socket — just wait and count the attempt
        if (state !== WebSocket.CONNECTING) openWsRef.current()
        setStatus('reconnecting')
        setTimeout(attempt, RETRY_DELAY_MS)
      }
    },
    [wsRef, openWsRef, attemptsRef, setStatus]
  )

  return attempt
}

// Called by openWs when a connection attempt fails (ticket fetch error, socket error, etc.)
// so that the first failure immediately enters the reconnect loop rather than freezing.
function useOnOpenWsFailed(attempt: () => void, { attemptsRef, setStatus }: Loop): () => void {
  return useCallback(() => {
    if (attemptsRef.current < MAX_ATTEMPTS) {
      attemptsRef.current += 1
      setStatus('reconnecting')
      setTimeout(attempt, RETRY_DELAY_MS)
    } else {
      setStatus('disconnected')
    }
  }, [attempt, attemptsRef, setStatus])
}

/** Coming back to the page starts a fresh round of attempts if the socket is not open. */
function useAttemptWhenVisible(
  wsRef: Loop['wsRef'],
  attemptsRef: Loop['attemptsRef'],
  attempt: () => void
): void {
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wsRef.current?.readyState !== WebSocket.OPEN) {
        attemptsRef.current = 0
        attempt()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [attempt, wsRef, attemptsRef])
}
