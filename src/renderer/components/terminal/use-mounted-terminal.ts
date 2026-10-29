import type React from 'react'
import { useLayoutEffect } from 'react'
import { useSessionStore } from '../../stores/session.store'

/** Puts the session's xterm in the container while the component is mounted. */
export function useMountedTerminal(
  containerRef: React.RefObject<HTMLDivElement | null>,
  sessionId: string
): void {
  useLayoutEffect(() => {
    const instance = useSessionStore.getState().getTerminalInstance(sessionId)
    const container = containerRef.current
    if (!instance || !container) return
    instance.mount(container)
    return () => {
      instance.unmount(container)
    }
  }, [containerRef, sessionId])
}
