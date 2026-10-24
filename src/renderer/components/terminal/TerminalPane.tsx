import { useShallow } from 'zustand/react/shallow'
import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { useBreakoutStore } from '../../stores/breakout.store'
import { useSessionStore } from '../../stores/session.store'
import { useModalStore } from '../../stores/modal.store'
import { Button } from '@terminator/extension-ui'
import { useTerminalOpenErrorStore } from '../../stores/terminal-open-error.store'
import type { PaneNode } from '@shared/types/index'
import { SplitContainer } from './SplitContainer'
import { LeafPane } from './LeafPane'
import { leafIds } from '../../utils/pane-tree'
import './TerminalPane.css'
import { droppedPaths } from './dropped-paths'

interface Props {
  projectId: string
}

const instanceOf = (sessionId: string) => useSessionStore.getState().getTerminalInstance(sessionId)

/** What the pane draws: its project's tabs, the one showing, and that tab's split. */
function usePaneState(projectId: string) {
  const store = useSessionStore(
    useShallow((s) => ({
      getSessionsForProject: s.getSessionsForProject,
      getActiveSessionForProject: s.getActiveSessionForProject,
      getPaneLayout: s.getPaneLayout,
      focusRequest: s.focusRequest,
      sessions: s.sessions,
      projectViews: s.projectViews,
      terminalInstances: s.terminalInstances,
    }))
  )
  const activeSessionId = store.getActiveSessionForProject(projectId)
  return {
    activeSessionId,
    shownSessionId: useIsBrokenOut(activeSessionId) ? null : activeSessionId,
    hasSessions: store.getSessionsForProject(projectId).length > 0,
    layout: store.getPaneLayout(projectId),
    focusRequest: store.focusRequest,
  }
}

/** Whether the tab is drawn by its own window, so this pane must leave the terminal to it. */
function useIsBrokenOut(sessionId: string | null): boolean {
  return useBreakoutStore((s) => sessionId !== null && s.windows.has(sessionId))
}

/** A tab that opened clears the open error; the tab on screen has its bells seen. */
function useShownTabSeen(
  projectId: string,
  { hasSessions, activeSessionId }: { hasSessions: boolean; activeSessionId: string | null }
): void {
  const clearOpenError = useTerminalOpenErrorStore((s) => s.clearError)
  useEffect(() => {
    if (hasSessions) clearOpenError(projectId)
  }, [hasSessions, projectId, clearOpenError])

  useEffect(() => {
    if (activeSessionId) useSessionStore.getState().clearBellCount(activeSessionId)
  }, [activeSessionId])
}

/** Takes the previous terminal off screen and puts the next one in the container. */
function swapTerminal(
  prevId: string | null,
  nextId: string | null,
  container: HTMLDivElement | null
): void {
  if (prevId) instanceOf(prevId)?.unmount(container ?? undefined)
  if (nextId && container) instanceOf(nextId)?.mount(container)
}

/** Single-pane mode: mounts the active terminal in the container, unmounting the one before. */
function useSinglePaneMount(
  containerRef: React.RefObject<HTMLDivElement>,
  activeSessionId: string | null,
  layout: PaneNode | null
): void {
  const prevSessionIdRef = useRef<string | null>(null)
  useEffect(() => {
    const prevId = prevSessionIdRef.current
    if (layout) {
      // LeafPane handles mounting in split mode. Reset ref so when the split
      // collapses, the surviving terminal gets remounted correctly. A tab that
      // showed alone and is no pane of this split goes off screen.
      if (prevId && !leafIds(layout).includes(prevId))
        instanceOf(prevId)?.unmount(containerRef.current ?? undefined)
      prevSessionIdRef.current = null
      return
    }
    if (prevId === activeSessionId) return
    swapTerminal(prevId, activeSessionId, containerRef.current)
    prevSessionIdRef.current = activeSessionId
  }, [containerRef, activeSessionId, layout])

  // Cleanup on unmount — useLayoutEffect so snapshot capture precedes browser layout.
  // The pane only ever holds a session it shows itself (a broken-out one is never prevSessionId),
  // and its container is remounted on a split collapse, so this unmounts unconditionally.
  useLayoutEffect(() => {
    return () => {
      const currentId = prevSessionIdRef.current
      prevSessionIdRef.current = null
      if (currentId) instanceOf(currentId)?.unmount()
    }
  }, [])
}

type PaneState = ReturnType<typeof usePaneState>

// Keyed on focusRequest.nonce, which every "go to session" path bumps even for the active session,
// for this pane's sessions only. A request is met once: a modal closing meets one made while it was
// open, and never re-takes focus from what an action focused (Edit session note's editor).
function useFocusRequests(
  projectId: string,
  { focusRequest, layout, activeSessionId }: PaneState
): void {
  const modalOpen = useModalStore((s) => s.depth > 0)
  const metNonce = useRef<number | null>(null)
  useEffect(() => {
    if (!focusRequest || modalOpen || metNonce.current === focusRequest.nonce) return
    const { sessionId, nonce } = focusRequest
    const belongsHere = layout ? leafIds(layout).includes(sessionId) : activeSessionId === sessionId
    if (!belongsHere) return
    if (layout) useSessionStore.getState().setFocusedSession(projectId, sessionId)
    // A modal can open between this effect and the frame (⌘P right after
    // Settings closes); focusing the terminal then would steal its keys.
    requestAnimationFrame(() => {
      if (useModalStore.getState().depth > 0) return
      metNonce.current = nonce
      instanceOf(sessionId)?.terminal.focus()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest?.nonce, modalOpen])
}

/** Focuses the active terminal now and whenever the window regains focus. */
function useRefocusActive(activeSessionId: string | null): () => void {
  const refocusActive = useCallback(() => {
    if (!activeSessionId) return
    instanceOf(activeSessionId)?.terminal.focus()
  }, [activeSessionId])

  useEffect(() => {
    window.addEventListener('focus', refocusActive)
    return () => window.removeEventListener('focus', refocusActive)
  }, [refocusActive])
  return refocusActive
}

export function TerminalPane({ projectId }: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const pane = usePaneState(projectId)
  const { activeSessionId, layout } = pane
  useShownTabSeen(projectId, pane)
  useSinglePaneMount(containerRef, pane.shownSessionId, layout)
  useFocusRequests(projectId, pane)
  const refocusActive = useRefocusActive(activeSessionId)
  const handleRatioChange = useCallback(
    (splitId: string, ratio: number) =>
      useSessionStore.getState().setSplitRatio(projectId, splitId, ratio),
    [projectId]
  )

  if (!pane.hasSessions) return <EmptyTerminalPane projectId={projectId} />
  if (layout) {
    return (
      <div className="terminal-pane terminal-pane--split">
        {renderNode(layout, projectId, handleRatioChange)}
      </div>
    )
  }
  return (
    <SingleTerminal
      containerRef={containerRef}
      activeSessionId={activeSessionId}
      refocusActive={refocusActive}
    />
  )
}

/** No tab yet: a prompt to open one, or why the last one would not open. */
function EmptyTerminalPane({ projectId }: Props): JSX.Element {
  const openError = useTerminalOpenErrorStore((s) => s.errors[projectId])
  const retryOpen = useTerminalOpenErrorStore((s) => s.retry)
  return (
    <div className="terminal-pane terminal-pane--empty">
      {openError ? (
        <div className="terminal-pane__open-error" role="alert">
          <span>Couldn&apos;t open a terminal: {openError}</span>
          <Button onClick={() => retryOpen(projectId)}>Try again</Button>
        </div>
      ) : (
        <span>Open a terminal tab to get started</span>
      )}
    </div>
  )
}

function handleDragOver(e: React.DragEvent<HTMLDivElement>): void {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault()
}

interface SingleTerminalProps {
  containerRef: React.RefObject<HTMLDivElement>
  activeSessionId: string | null
  refocusActive: () => void
}

/** One tab alone: a click focuses it, and files dropped on it paste their paths. */
function SingleTerminal({ containerRef, activeSessionId, refocusActive }: SingleTerminalProps) {
  function handleMouseDown(e: React.MouseEvent): void {
    if (e.button !== 0) return
    refocusActive()
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>): void {
    e.preventDefault()
    const instance = activeSessionId ? instanceOf(activeSessionId) : undefined
    if (!instance) return
    const paths = droppedPaths(e.dataTransfer.files)
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
