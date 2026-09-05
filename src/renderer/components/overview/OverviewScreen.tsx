import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { LayoutGrid, Rows3 } from 'lucide-react'
import { useSessionStore } from '../../stores/session.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { useMetricsStore } from '../../stores/metrics.store'
import { useExtensionRegistry } from '../../extensions/registry'
import { SessionTile } from './SessionTile'
import { BoardScreen } from './BoardScreen'
import {
  buildLanes,
  loadHiddenLanes,
  saveHiddenLanes,
  type BoardCard,
} from '../../sidebar/board-lanes'
import type { AgentState } from '../../../shared/types/index'
import { SCRATCH_PROJECT_ID } from '../../../shared/types/index'
import './OverviewScreen.css'

type Layout = 'board' | 'list'

/**
 * Every terminal in the app, on one surface.
 *
 * Two layouts: a board that groups by state, and the flat list this screen used
 * to be. Board is the default — "which terminal is in what state" is the
 * question this surface exists to answer, and the flat grid never answered it.
 *
 * The layout choice is deliberately not persisted, matching the decision that
 * the sidebar's active view is not restored either: opening to a narrowed
 * surface reads as data loss.
 */
export function OverviewScreen(): JSX.Element {
  const { sessions } = useSessionStore()
  const { workspaces, projectsByWorkspaceId, setScratchActive } = useWorkspaceStore()
  const { processesBySessionId, startPolling, stopPolling } = useMetricsStore()

  const [layout, setLayout] = useState<Layout>('board')
  const [hiddenLanes, setHiddenLanes] = useState<AgentState[]>(() => loadHiddenLanes())

  const projects = useMemo(
    () => [...projectsByWorkspaceId.values()].flat(),
    [projectsByWorkspaceId]
  )

  const open = useMemo(() => [...sessions.values()], [sessions])

  const lanes = useMemo(
    () => buildLanes(open, projects, workspaces, hiddenLanes),
    [open, projects, workspaces, hiddenLanes]
  )

  const cards = useMemo(() => lanes.flatMap((lane) => lane.cards), [lanes])

  // One clock read per render rather than one per card, so every age on screen
  // is measured from the same instant.
  const now = Date.now()

  const sessionIdsKey = cards.map((c) => c.sessionId).join(',')
  useEffect(() => {
    if (sessionIdsKey === '') {
      startPolling([])
      return stopPolling
    }
    let cancelled = false
    window.electronAPI.metrics
      .getPids(sessionIdsKey.split(','))
      .then((result) => {
        if (cancelled) return
        startPolling('data' in result ? result.data : [])
      })
      .catch(() => {
        if (!cancelled) startPolling([])
      })
    return () => {
      cancelled = true
      stopPolling()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIdsKey])

  const navigate = useCallback(
    (sessionId: string): void => {
      const session = useSessionStore.getState().sessions.get(sessionId)
      if (session === undefined) return
      useExtensionRegistry.getState().setActiveGlobalTab(null)

      if (session.projectId === SCRATCH_PROJECT_ID) {
        useSessionStore.getState().setActiveSessionForProject(SCRATCH_PROJECT_ID, sessionId)
        setScratchActive(true)
        return
      }
      const project = projects.find((p) => p.id === session.projectId)
      if (project === undefined) return
      const { activeWorkspaceId, setActiveWorkspace, setActiveProject } =
        useWorkspaceStore.getState()
      if (project.workspaceId !== activeWorkspaceId) setActiveWorkspace(project.workspaceId)
      setActiveProject(project.id)
      useSessionStore.getState().setActiveSessionForProject(project.id, sessionId)
    },
    [projects, setScratchActive]
  )

  const toggleLane = useCallback((state: AgentState): void => {
    setHiddenLanes((current) => {
      const next = current.includes(state)
        ? current.filter((s) => s !== state)
        : [...current, state]
      saveHiddenLanes(next)
      return next
    })
  }, [])

  const renderCard = useCallback(
    (card: BoardCard) => (
      <SessionTile
        card={card}
        processMetrics={processesBySessionId.get(card.sessionId) ?? null}
        now={now}
        onNavigate={() => navigate(card.sessionId)}
      />
    ),
    [processesBySessionId, now, navigate]
  )

  return (
    <div className="overview-screen">
      <div className="overview-screen__bar">
        <div className="overview-screen__layouts" role="group" aria-label="Layout">
          <button
            type="button"
            className="overview-screen__layout"
            aria-pressed={layout === 'board'}
            aria-label="Board"
            onClick={() => setLayout('board')}
          >
            <LayoutGrid aria-hidden="true" />
          </button>
          <button
            type="button"
            className="overview-screen__layout"
            aria-pressed={layout === 'list'}
            aria-label="List"
            onClick={() => setLayout('list')}
          >
            <Rows3 aria-hidden="true" />
          </button>
        </div>
      </div>

      {layout === 'board' ? (
        <BoardScreen
          lanes={lanes}
          renderCard={renderCard}
          onToggleLane={toggleLane}
          onEmpty={() => useExtensionRegistry.getState().setActiveGlobalTab(null)}
        />
      ) : cards.length === 0 ? (
        <div className="overview-screen__empty">No open terminals</div>
      ) : (
        <div className="overview-screen__grid">
          {cards.map((card) => (
            <React.Fragment key={card.sessionId}>{renderCard(card)}</React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}
