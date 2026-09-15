import React, { useLayoutEffect, useRef } from 'react'
import { useSessionStore } from '../../stores/session.store'
import './LivePreview.css'

interface Props {
  sessionId: string
  className?: string
}

/**
 * A session's live terminal, scaled into a box.
 *
 * `mountPreview` moves the session's one xterm element in here, so this node
 * must never be re-parented or remounted while the session is the same: doing
 * so tears the live terminal out. Only `sessionId` re-runs the effect.
 */
export function LivePreview({ sessionId, className }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const getTerminalInstance = useSessionStore((s) => s.getTerminalInstance)

  useLayoutEffect(() => {
    const instance = getTerminalInstance(sessionId)
    if (!instance || !ref.current) return
    return instance.mountPreview(ref.current) ?? undefined
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return <div ref={ref} className={`live-preview${className ? ` ${className}` : ''}`} />
}
