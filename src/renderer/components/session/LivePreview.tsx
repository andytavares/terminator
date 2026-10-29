import React, { useLayoutEffect, useRef } from 'react'
import { AppWindow } from 'lucide-react'
import { Button } from '@terminator/extension-ui'
import { useBreakoutStore } from '../../stores/breakout.store'
import { useSessionStore } from '../../stores/session.store'
import { revealSession } from '../../terminal/navigate-to-session'
import './LivePreview.css'

interface Props {
  sessionId: string
  className?: string
}

/** What stands in for the preview of a terminal that lives in its own window: pulling its element
 * out of that window would blank it, so this shows the last line it printed and a way to it. */
function InOwnWindow({ sessionId, className }: Props): React.JSX.Element {
  const latestLine = useSessionStore((s) => s.sessions.get(sessionId)?.latestLine)
  return (
    <div className={`live-preview-window${className ? ` ${className}` : ''}`}>
      <span className="live-preview-window__line">{latestLine}</span>
      <span className="live-preview-window__note">
        <AppWindow aria-hidden="true" />
        In its own window
      </span>
      <Button size="sm" onClick={() => revealSession(sessionId)}>
        Show window
      </Button>
    </div>
  )
}

/** A session's live terminal in a box, or where to find it when it has a window of its own. */
export function LivePreview({ sessionId, className }: Props): React.JSX.Element {
  const isBrokenOut = useBreakoutStore((s) => s.windows.has(sessionId))
  return isBrokenOut ? (
    <InOwnWindow sessionId={sessionId} className={className} />
  ) : (
    <MountedPreview sessionId={sessionId} className={className} />
  )
}

/**
 * A session's live terminal, scaled into a box.
 *
 * `mountPreview` moves the session's one xterm element in here, so this node
 * must never be re-parented or remounted while the session is the same: doing
 * so tears the live terminal out. Only `sessionId` re-runs the effect.
 */
function MountedPreview({ sessionId, className }: Props): React.JSX.Element {
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
