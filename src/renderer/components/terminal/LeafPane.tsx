import React, { useRef, useLayoutEffect, useCallback } from 'react'
import { useSessionStore } from '../../stores/session.store'
import './LeafPane.css'

interface Props {
  sessionId: string
  projectId: string
}

export function LeafPane({ sessionId, projectId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const { getTerminalInstance, getFocusedSession, setFocusedSession, clearBellCount, sessions } =
    useSessionStore()
  const isFocused = getFocusedSession(projectId) === sessionId
  const session = sessions.get(sessionId)
  const tabTitle = session?.tabTitle ?? sessionId

  useLayoutEffect(() => {
    const instance = getTerminalInstance(sessionId)
    if (!instance || !containerRef.current) return
    instance.mount(containerRef.current)
    return () => {
      instance.unmount()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      setFocusedSession(projectId, sessionId)
      clearBellCount(sessionId)
      const instance = getTerminalInstance(sessionId)
      if (instance?.isAtBottom) instance.terminal.scrollToBottom()
      instance?.terminal.focus()
    },
    [projectId, sessionId, setFocusedSession, clearBellCount, getTerminalInstance]
  )

  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    const instance = getTerminalInstance(sessionId)
    if (!instance) return
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => (f as unknown as { path: string }).path)
      .filter(Boolean)
      .map((p) => (/\s/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p))
      .join(' ')
    if (paths) instance.terminal.paste(paths)
  }

  return (
    <div
      className={`leaf-pane${isFocused ? ' leaf-pane--focused' : ''}`}
      onMouseDown={handleMouseDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="leaf-pane__titlebar">
        <span className="leaf-pane__title">{tabTitle}</span>
      </div>
      <div ref={containerRef} className="leaf-pane__container" />
    </div>
  )
}
