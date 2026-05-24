import { useState, useEffect, useCallback } from 'react'
import { useSessionStore } from '../stores/session.store'
import type { TerminalInstance } from '../components/terminal/TerminalSession'

export function useTerminalSnapshot(sessionId: string, intervalMs = 3000): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const getTerminalInstance = useSessionStore((s) => s.getTerminalInstance)

  const capture = useCallback(() => {
    const instance = getTerminalInstance(sessionId) as TerminalInstance | undefined
    if (!instance) return
    // Try a live composite; if canvases are gone/zeroed (terminal unmounted), use
    // the snapshot captured in unmount() so Overview always has something to show.
    const url = instance.captureToDataUrl() ?? instance.lastSnapshot
    if (url) setDataUrl(url)
  }, [sessionId, getTerminalInstance])

  useEffect(() => {
    capture()
    const id = setInterval(capture, intervalMs)
    return () => clearInterval(id)
  }, [capture, intervalMs])

  return dataUrl
}
