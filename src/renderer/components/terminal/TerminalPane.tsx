import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useSessionStore } from '../../stores/session.store'
import type { PaneNode } from '../../../../shared/types/index'
import { SplitContainer } from './SplitContainer'
import { LeafPane } from './LeafPane'
import './TerminalPane.css'

interface Props {
  projectId: string
}

export function TerminalPane({ projectId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const prevSessionIdRef = useRef<string | null>(null)
  const {
    getSessionsForProject,
    getActiveSessionForProject,
    getTerminalInstance,
    clearBellCount,
    getPaneLayout,
    setSplitRatio,
    setFocusedSession,
  } = useSessionStore()

  const activeSessionId = getActiveSessionForProject(projectId)
  const sessions = getSessionsForProject(projectId)
  const layout = getPaneLayout(projectId)

  // All hooks must run unconditionally before any early return.
  useEffect(() => {
    if (activeSessionId) clearBellCount(activeSessionId)
  }, [activeSessionId, clearBellCount])

  // Single-pane mode: mount/unmount the active terminal when it changes.
  useEffect(() => {
    if (layout) {
      // LeafPane handles mounting in split mode. Reset ref so when the split
      // collapses, the surviving terminal gets remounted correctly.
      prevSessionIdRef.current = null
      return
    }
    const prevId = prevSessionIdRef.current
    const nextId = activeSessionId
    if (prevId === nextId) return

    if (prevId) {
      const prev = getTerminalInstance(prevId)
      prev?.unmount()
    }

    if (nextId && containerRef.current) {
      const next = getTerminalInstance(nextId)
      next?.mount(containerRef.current)
    }

    prevSessionIdRef.current = nextId
  }, [activeSessionId, layout, getTerminalInstance])

  // Cleanup on unmount — useLayoutEffect so snapshot capture precedes browser layout.
  useLayoutEffect(() => {
    return () => {
      const currentId = prevSessionIdRef.current
      prevSessionIdRef.current = null
      if (currentId) {
        const instance = getTerminalInstance(currentId)
        instance?.unmount()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // In split mode, focus the active terminal when it changes (e.g., sidebar click).
  // layout is intentionally excluded from deps: changes to split ratio should not
  // clobber focus that activateSplit or the user already set.
  useEffect(() => {
    if (!layout || !activeSessionId) return
    setFocusedSession(projectId, activeSessionId)
    getTerminalInstance(activeSessionId)?.terminal.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, projectId, setFocusedSession, getTerminalInstance])

  const refocusActive = useCallback(() => {
    if (!activeSessionId) return
    const instance = getTerminalInstance(activeSessionId)
    if (!instance) return
    if (instance.isAtBottom) instance.terminal.scrollToBottom()
    instance.terminal.focus()
  }, [activeSessionId, getTerminalInstance])

  useEffect(() => {
    window.addEventListener('focus', refocusActive)
    return () => window.removeEventListener('focus', refocusActive)
  }, [refocusActive])

  const handleRatioChange = useCallback(
    (splitId: string, ratio: number) => {
      setSplitRatio(projectId, splitId, ratio)
    },
    [projectId, setSplitRatio]
  )

  if (sessions.length === 0) {
    return (
      <div className="terminal-pane terminal-pane--empty">
        <span>Open a terminal tab to get started</span>
      </div>
    )
  }

  if (layout) {
    return (
      <div className="terminal-pane terminal-pane--split">
        {renderNode(layout, projectId, handleRatioChange)}
      </div>
    )
  }

  function handleMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return
    refocusActive()
  }

  function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    if (!activeSessionId) return
    const instance = getTerminalInstance(activeSessionId)
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
      className="terminal-pane"
      onMouseDown={handleMouseDown}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div ref={containerRef} className="terminal-pane__container" />
    </div>
  )
}

function renderNode(
  node: PaneNode,
  projectId: string,
  onRatioChange: (splitId: string, ratio: number) => void
): JSX.Element {
  if (node.type === 'leaf') {
    return <LeafPane key={node.sessionId} sessionId={node.sessionId} projectId={projectId} />
  }
  return (
    <SplitContainer
      key={node.id}
      splitId={node.id}
      direction={node.direction}
      ratio={node.ratio}
      onRatioChange={onRatioChange}
    >
      {[
        renderNode(node.first, projectId, onRatioChange),
        renderNode(node.second, projectId, onRatioChange),
      ]}
    </SplitContainer>
  )
}
