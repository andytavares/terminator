import React, { useRef, useLayoutEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { useSessionStore } from '../../stores/session.store'
import './LeafPane.css'

interface Props {
  sessionId: string
  projectId: string
}

export function LeafPane({ sessionId, projectId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const {
    getTerminalInstance,
    getFocusedSession,
    setFocusedSession,
    clearBellCount,
    sessions,
    closeSplitLeaf,
    closeSession,
  } = useSessionStore()
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
      instance?.terminal.focus()
    },
    [projectId, sessionId, setFocusedSession, clearBellCount, getTerminalInstance]
  )

  /**
   * Closing this pane, and only this pane.
   *
   * The titlebar carried a name and nothing else, so a split pane could be
   * opened and never shut: the only way out was Cmd+W, which is invisible and
   * which reads as "close the tab" — the tab being the thing a person is
   * trying not to lose. Same two steps the shortcut takes: leave the layout,
   * then end the session.
   */
  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      closeSplitLeaf(projectId, sessionId)
      void closeSession(sessionId)
    },
    [projectId, sessionId, closeSplitLeaf, closeSession]
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
        <button
          type="button"
          className="leaf-pane__close"
          aria-label={`Close ${tabTitle}`}
          title="Close this pane"
          onClick={handleClose}
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div ref={containerRef} className="leaf-pane__container" />
    </div>
  )
}
