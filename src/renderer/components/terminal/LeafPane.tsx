import React, { useRef, useLayoutEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { useSessionStore } from '../../stores/session.store'
import './LeafPane.css'
import { droppedPaths } from './dropped-paths'

interface Props {
  sessionId: string
  projectId: string
}

/** Puts the session's xterm in the container while the pane is mounted. */
function useMountedTerminal(
  containerRef: React.RefObject<HTMLDivElement>,
  sessionId: string
): void {
  useLayoutEffect(() => {
    const instance = useSessionStore.getState().getTerminalInstance(sessionId)
    if (!instance || !containerRef.current) return
    instance.mount(containerRef.current)
    return () => {
      instance.unmount()
    }
  }, [containerRef, sessionId])
}

function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault()
}

/** Focusing the pane, closing it, and pasting the paths of files dropped on it. */
function usePaneHandlers({ sessionId, projectId }: Props) {
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return
      const store = useSessionStore.getState()
      store.setFocusedSession(projectId, sessionId)
      store.clearBellCount(sessionId)
      store.getTerminalInstance(sessionId)?.terminal.focus()
    },
    [projectId, sessionId]
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
      useSessionStore.getState().closeSplitLeaf(projectId, sessionId)
      void useSessionStore.getState().closeSession(sessionId)
    },
    [projectId, sessionId]
  )

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    const instance = useSessionStore.getState().getTerminalInstance(sessionId)
    if (!instance) return
    const paths = droppedPaths(e.dataTransfer.files)
    if (paths) instance.terminal.paste(paths)
  }
  return { handleMouseDown, handleClose, handleDrop }
}

export function LeafPane({ sessionId, projectId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const isFocused = useSessionStore((s) => s.getFocusedSession(projectId) === sessionId)
  const tabTitle = useSessionStore((s) => s.sessions.get(sessionId)?.tabTitle ?? sessionId)
  useMountedTerminal(containerRef, sessionId)
  const { handleMouseDown, handleClose, handleDrop } = usePaneHandlers({ sessionId, projectId })

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
