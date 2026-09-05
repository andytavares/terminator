import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BoardScreen } from '../../../../src/renderer/components/overview/BoardScreen'
import type { BoardCard, BoardLane } from '../../../../src/renderer/sidebar/board-lanes'
import type { AgentState } from '../../../../src/shared/types/index'

function card(sessionId: string, state: AgentState, patch: Partial<BoardCard> = {}): BoardCard {
  return {
    sessionId,
    title: sessionId,
    sourceLabel: 'terminator / main',
    state,
    bellCount: 0,
    lastActivityAt: 0,
    workspaceColor: '#5c6bc0',
    ...patch,
  }
}

const LABEL: Record<AgentState, string> = {
  'awaiting-input': 'Needs you',
  working: 'Working',
  idle: 'Idle',
  exited: 'Exited',
}

function lanes(
  spec: Partial<Record<AgentState, BoardCard[]>>,
  hidden: AgentState[] = []
): BoardLane[] {
  const order: AgentState[] = ['awaiting-input', 'working', 'idle', 'exited']
  return order.map((state) => {
    const cards = spec[state] ?? []
    const isHistory = state === 'exited'
    return {
      state,
      label: LABEL[state],
      cards,
      count: cards.length,
      visible: !hidden.includes(state) && !(isHistory && cards.length === 0),
      isHistory,
    }
  })
}

const renderCard = (c: BoardCard) => <span data-testid={`card-${c.sessionId}`}>{c.title}</span>

const renderBoard = (l: BoardLane[], props = {}) =>
  render(
    <BoardScreen
      lanes={l}
      renderCard={renderCard}
      onToggleLane={vi.fn()}
      onEmpty={vi.fn()}
      {...props}
    />
  )

describe('BoardScreen', () => {
  it('draws a header per visible lane with its label and count', () => {
    const { container } = renderBoard(
      lanes({ working: [card('a', 'working'), card('b', 'working')] })
    )
    const headers = container.querySelectorAll('.board__lane-head')
    expect(headers).toHaveLength(3) // exited hides itself while empty
    expect(screen.getByText('Working')).toBeTruthy()
    const working = [...headers].find((h) => h.textContent?.includes('Working'))!
    expect(working.querySelector('.board__lane-count')!.textContent).toBe('2')
  })

  it('shows the count the lane reports and nothing else (FR-039)', () => {
    const { container } = renderBoard(lanes({ idle: [card('a', 'idle')] }))
    for (const head of container.querySelectorAll('.board__lane-head')) {
      const label = head.querySelector('.board__lane-label')!.textContent!
      const count = Number(head.querySelector('.board__lane-count')!.textContent)
      const drawn = [
        ...(head.closest('.board')?.querySelectorAll('[data-session-id]') ?? []),
      ].filter((c) => (c as HTMLElement).dataset.lane === label).length
      expect(count).toBe(drawn)
    }
  })

  // FR-009. An empty lane keeps its header — that nothing is waiting on you is
  // worth reading — but draws nothing beneath it.
  it('draws nothing in an empty lane body', () => {
    const { container } = renderBoard(lanes({ working: [card('a', 'working')] }))
    // The header carries data-lane too, so scope this to card slots.
    const idleCards = container.querySelectorAll('.board__slot[data-lane="Idle"]')
    expect(idleCards).toHaveLength(0)
    expect(screen.getByText('Idle')).toBeTruthy()
    expect(container.textContent).not.toMatch(/no terminals here|nothing to show/i)
  })

  it('omits a lane the lane model marks invisible', () => {
    const { container } = renderBoard(lanes({ working: [card('a', 'working')] }, ['idle']))
    expect(container.querySelector('.board__lane-head[data-lane="Idle"]')).toBeNull()
  })

  it('marks the history lane so it can be held back visually', () => {
    const { container } = renderBoard(lanes({ exited: [card('z', 'exited')] }))
    expect(container.querySelector('.board__lane-head--history')).toBeTruthy()
  })

  // The structural guarantee. Every card is a direct child of the one grid, so
  // a lane is a column rather than a container.
  it('renders every card as a direct child of the single grid', () => {
    const { container } = renderBoard(
      lanes({ working: [card('a', 'working')], idle: [card('b', 'idle')] })
    )
    const grid = container.querySelector('.board')!
    const cards = container.querySelectorAll('[data-session-id]')
    expect(cards).toHaveLength(2)
    for (const c of cards) expect(c.parentElement).toBe(grid)
  })

  it('positions a card by grid column and row rather than by nesting', () => {
    const { container } = renderBoard(
      lanes({ 'awaiting-input': [card('a', 'awaiting-input')], idle: [card('b', 'idle')] })
    )
    const a = container.querySelector<HTMLElement>('[data-session-id="a"]')!
    const b = container.querySelector<HTMLElement>('[data-session-id="b"]')!
    expect(a.style.gridColumn).toBe('1')
    expect(b.style.gridColumn).toBe('3')
    expect(a.style.gridRow).toBe('2')
  })

  it('stacks cards down their own column', () => {
    const { container } = renderBoard(
      lanes({ working: [card('a', 'working'), card('b', 'working')] })
    )
    const rows = ['a', 'b'].map(
      (id) => container.querySelector<HTMLElement>(`[data-session-id="${id}"]`)!.style.gridRow
    )
    expect(rows).toEqual(['2', '3'])
  })

  /**
   * T017 — the reason the board is one grid.
   *
   * `mountPreview` moves the single live xterm element into the card's node.
   * If a state change re-parented or re-created that node, React would run the
   * layout effect's cleanup, tear the element out, and the preview would blank
   * in the middle of the very transition FR-011 exists to show.
   */
  it('keeps a card on the same DOM node when it changes lane', () => {
    const { container, rerender } = renderBoard(lanes({ working: [card('a', 'working')] }))
    const before = container.querySelector('[data-session-id="a"]')
    expect(before).toBeTruthy()

    rerender(
      <BoardScreen
        lanes={lanes({ 'awaiting-input': [card('a', 'awaiting-input')] })}
        renderCard={renderCard}
        onToggleLane={vi.fn()}
        onEmpty={vi.fn()}
      />
    )

    const after = container.querySelector('[data-session-id="a"]')
    expect(after).toBe(before)
    expect(after!.getAttribute('style')).toContain('grid-column: 1')
  })

  it('keeps every card node stable when another card changes lane', () => {
    const { container, rerender } = renderBoard(
      lanes({ working: [card('a', 'working'), card('b', 'working')] })
    )
    const nodes = ['a', 'b'].map((id) => container.querySelector(`[data-session-id="${id}"]`))

    rerender(
      <BoardScreen
        lanes={lanes({ working: [card('b', 'working')], idle: [card('a', 'idle')] })}
        renderCard={renderCard}
        onToggleLane={vi.fn()}
        onEmpty={vi.fn()}
      />
    )

    const after = ['a', 'b'].map((id) => container.querySelector(`[data-session-id="${id}"]`))
    expect(after).toEqual(nodes)
  })

  // FR-009 as amended. An empty lane is silent; an empty board is not, or the
  // first run is four headers over a dead screen.
  it('offers one line and one action when nothing is running at all', () => {
    const onEmpty = vi.fn()
    const { container } = renderBoard(lanes({}), { onEmpty })
    expect(container.querySelector('.board')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /start a branch/i }))
    expect(onEmpty).toHaveBeenCalled()
  })

  it('does not show the empty board while any lane holds a card', () => {
    renderBoard(lanes({ exited: [card('z', 'exited')] }))
    expect(screen.queryByRole('button', { name: /start a branch/i })).toBeNull()
  })

  it('lets a lane be hidden from its header', () => {
    const onToggleLane = vi.fn()
    const { container } = renderBoard(lanes({ working: [card('a', 'working')] }), { onToggleLane })
    const toggle = container.querySelector<HTMLElement>(
      '.board__lane-head[data-lane="Working"] .board__lane-toggle'
    )!
    fireEvent.click(toggle)
    expect(onToggleLane).toHaveBeenCalledWith('working')
  })

  it('gives every lane header an accessible name', () => {
    const { container } = renderBoard(lanes({ working: [card('a', 'working')] }))
    for (const t of container.querySelectorAll('.board__lane-toggle')) {
      expect(t.getAttribute('aria-label')).toBeTruthy()
    }
  })
})

/**
 * The FLIP path. Grid placement is discrete and cannot be transitioned, so a
 * moved card is played back from where it was. jsdom reports every rect as
 * zero, so the positions have to be stubbed or this branch is never entered —
 * which is exactly how it reached the patch-coverage gate uncovered.
 */
describe('BoardScreen — replaying a card that changed lane', () => {
  const positions = new Map<string, { left: number; top: number }>()
  let rect: ReturnType<typeof vi.spyOn> | null = null

  function stubPositions(): void {
    rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const at = positions.get(this.dataset?.sessionId ?? '') ?? { left: 0, top: 0 }
      return {
        ...at,
        right: at.left,
        bottom: at.top,
        width: 0,
        height: 0,
        x: at.left,
        y: at.top,
        toJSON: () => ({}),
      } as DOMRect
    })
  }

  afterEach(() => {
    rect?.mockRestore()
    rect = null
    positions.clear()
    vi.unstubAllGlobals()
  })

  function moveCard(reduced = false): HTMLElement {
    vi.stubGlobal('matchMedia', () => ({
      matches: reduced,
      media: '',
      addEventListener() {},
      removeEventListener() {},
    }))
    stubPositions()
    positions.set('a', { left: 20, top: 120 })
    const { container, rerender } = renderBoard(lanes({ working: [card('a', 'working')] }))
    positions.set('a', { left: 320, top: 60 })
    rerender(
      <BoardScreen
        lanes={lanes({ 'awaiting-input': [card('a', 'awaiting-input')] })}
        renderCard={renderCard}
        onToggleLane={vi.fn()}
        onEmpty={vi.fn()}
      />
    )
    return container.querySelector<HTMLElement>('[data-session-id="a"]')!
  }

  it('starts the card at its old position', () => {
    const node = moveCard()
    expect(node.style.transform).toBe('translate(-300px, 60px)')
    expect(node.style.opacity).toBe('0.55')
  })

  it('releases it to its new position on the next frame, over 180ms', async () => {
    const node = moveCard()
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    expect(node.style.transform).toBe('')
    expect(node.style.opacity).toBe('')
    expect(node.style.transition).toContain('180ms')
  })

  it('cuts straight to the new position when reduced motion is asked for', () => {
    const node = moveCard(true)
    expect(node.style.transform).toBe('')
  })

  it('does not replay a card that stayed where it was', () => {
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      media: '',
      addEventListener() {},
      removeEventListener() {},
    }))
    stubPositions()
    positions.set('a', { left: 10, top: 10 })
    const { container, rerender } = renderBoard(lanes({ working: [card('a', 'working')] }))
    rerender(
      <BoardScreen
        lanes={lanes({ working: [card('a', 'working', { title: 'renamed' })] })}
        renderCard={renderCard}
        onToggleLane={vi.fn()}
        onEmpty={vi.fn()}
      />
    )
    expect(container.querySelector<HTMLElement>('[data-session-id="a"]')!.style.transform).toBe('')
  })

  it('forgets a card that has gone, so its id cannot leak into a later replay', () => {
    stubPositions()
    positions.set('a', { left: 0, top: 0 })
    const { rerender, container } = renderBoard(lanes({ working: [card('a', 'working')] }))
    rerender(
      <BoardScreen
        lanes={lanes({ working: [card('b', 'working')] })}
        renderCard={renderCard}
        onToggleLane={vi.fn()}
        onEmpty={vi.fn()}
      />
    )
    expect(container.querySelector('[data-session-id="a"]')).toBeNull()
    expect(container.querySelector('[data-session-id="b"]')).toBeTruthy()
  })
})
