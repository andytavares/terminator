import React, { useLayoutEffect, useRef } from 'react'
import { Circle, CircleX, Eye, EyeOff, Pause, Play } from 'lucide-react'
import type { BoardCard, BoardLane } from '../../sidebar/board-lanes'
import type { AgentState } from '../../../shared/types/index'
import './BoardScreen.css'

interface Props {
  lanes: BoardLane[]
  renderCard: (card: BoardCard) => React.ReactNode
  onToggleLane: (state: AgentState) => void
  /** Invoked from the empty board's single action. */
  onEmpty: () => void
}

/**
 * Shape only, never hue — Constitution XII forbids differentiating an icon's
 * state by colour, which is also what keeps these four readable in greyscale.
 */
const LANE_ICON: Record<AgentState, typeof Pause> = {
  'awaiting-input': Pause,
  working: Play,
  idle: Circle,
  exited: CircleX,
}

const MOVE_MS = 180

/**
 * Every open terminal, in lanes by state.
 *
 * **A lane is a grid column, not a container.** Every card is a direct child of
 * the one grid and is positioned by `grid-column` / `grid-row`, and the cards
 * are emitted in a stable order that does not depend on their lane. That is
 * load-bearing rather than tidy: `mountPreview` moves the single live xterm
 * element into the card's node, so if a state change re-parented or reordered
 * that node, React would run the layout effect's cleanup and tear the live
 * preview out — in the middle of the very transition this component animates.
 * Here a state change alters two style properties and nothing else.
 */
export function BoardScreen({ lanes, renderCard, onToggleLane, onEmpty }: Props): JSX.Element {
  const gridRef = useRef<HTMLDivElement>(null)
  const lastRects = useRef(new Map<string, { left: number; top: number }>())

  const visible = lanes.filter((lane) => lane.visible)
  const hidden = lanes.filter((lane) => lane.hiddenByUser)
  const columnOf = new Map<AgentState, number>(visible.map((lane, i) => [lane.state, i + 1]))
  const totalCards = lanes.reduce((n, lane) => n + lane.cards.length, 0)

  // Row 1 holds the headers, so a card's own row starts at 2.
  const placed = lanes
    .filter((lane) => columnOf.has(lane.state))
    .flatMap((lane) =>
      lane.cards.map((card, i) => ({
        card,
        lane,
        column: columnOf.get(lane.state)!,
        row: i + 2,
      }))
    )
    // Stable across every state change, so React only ever rewrites a style.
    .sort((a, b) => a.card.sessionId.localeCompare(b.card.sessionId))

  /**
   * FLIP. `grid-column` and `grid-row` are discrete and cannot be transitioned,
   * so the move is animated by measuring where each card was, letting it land,
   * and playing it back from the old position. Only the card that actually
   * moved animates, and only its position and opacity (FR-011).
   */
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (grid === null) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    const seen = new Set<string>()

    for (const node of grid.querySelectorAll<HTMLElement>('[data-session-id]')) {
      const id = node.dataset.sessionId
      if (id === undefined) continue
      seen.add(id)
      const rect = node.getBoundingClientRect()
      const previous = lastRects.current.get(id)
      const moved =
        previous !== undefined && (previous.left !== rect.left || previous.top !== rect.top)

      if (moved && !reduced) {
        const dx = previous.left - rect.left
        const dy = previous.top - rect.top
        node.style.transition = 'none'
        node.style.transform = `translate(${dx}px, ${dy}px)`
        node.style.opacity = '0.55'
        requestAnimationFrame(() => {
          node.style.transition = `transform ${MOVE_MS}ms ease, opacity ${MOVE_MS}ms ease`
          node.style.transform = ''
          node.style.opacity = ''
        })
      }
      lastRects.current.set(id, { left: rect.left, top: rect.top })
    }

    for (const id of lastRects.current.keys()) if (!seen.has(id)) lastRects.current.delete(id)
  })

  // An empty lane is silent; an empty board is not, or first run is a set of
  // headers over a dead screen with no way in (FR-009).
  if (totalCards === 0) {
    return (
      <div className="board-empty">
        <p className="board-empty__line">No terminals running.</p>
        <button type="button" className="board-empty__action" onClick={onEmpty}>
          Start a branch
        </button>
      </div>
    )
  }

  return (
    <>
      {hidden.length > 0 && (
        /* The hide control lives in the lane header, and a hidden lane is not
           rendered — so hiding one took its own way back off the screen with
           it. This is that way back. */
        <div className="board__hidden-lanes">
          <span className="board__hidden-lanes-label">Hidden:</span>
          {hidden.map((lane) => (
            <button
              key={lane.state}
              type="button"
              className="board__hidden-lane"
              onClick={() => onToggleLane(lane.state)}
            >
              <Eye aria-hidden="true" />
              {lane.label}
            </button>
          ))}
        </div>
      )}
      <div
        className="board"
        ref={gridRef}
        style={{ ['--board-lanes' as string]: String(visible.length) }}
      >
        {visible.map((lane, i) => {
          const Icon = LANE_ICON[lane.state]
          return (
            <div
              key={lane.state}
              className={`board__lane-head${lane.isHistory ? ' board__lane-head--history' : ''}`}
              data-lane={lane.label}
              style={{ gridColumn: String(i + 1), gridRow: '1' }}
            >
              <Icon
                className={`board__lane-glyph board__state--${lane.state}`}
                aria-hidden="true"
              />
              <span className="board__lane-label">{lane.label}</span>
              <span className="board__lane-count">{lane.count}</span>
              <button
                type="button"
                className="board__lane-toggle"
                onClick={() => onToggleLane(lane.state)}
                aria-label={`Hide the ${lane.label} lane`}
              >
                <EyeOff aria-hidden="true" />
              </button>
            </div>
          )
        })}

        {placed.map(({ card, lane, column, row }) => (
          <div
            key={card.sessionId}
            className="board__slot"
            data-session-id={card.sessionId}
            data-lane={lane.label}
            style={{ gridColumn: String(column), gridRow: String(row) }}
          >
            {renderCard(card)}
          </div>
        ))}
      </div>
    </>
  )
}
