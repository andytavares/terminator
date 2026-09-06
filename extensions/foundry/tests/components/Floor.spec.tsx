import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import React from 'react'
import { Floor } from '../../src/components/Floor.js'

// Where you watch, not where you act — with one exception, which is getting
// into a running agent's terminal.
//
// The merge-order section is the multi-repository half: it only appears when
// there is more than one repository, and what it says about a hold is the
// rule's own sentence rather than a number the view reassembled.

const NODES = [
  {
    id: 'N-1',
    unitId: 'U-1',
    lane: 1,
    role: 'builder',
    kind: 'agent',
    state: 'running',
    sessionId: 's-1',
    attempts: 1,
    startedAt: null,
    endedAt: null,
    dependsOn: [],
    stepId: 'build',
  },
  {
    id: 'N-2',
    unitId: 'U-2',
    lane: 2,
    role: 'builder',
    kind: 'agent',
    state: 'waiting',
    sessionId: null,
    attempts: 0,
    startedAt: null,
    endedAt: null,
    dependsOn: ['N-1'],
    stepId: 'build',
  },
]

function reply(over: Record<string, unknown> = {}) {
  return {
    graph: { orderId: 'WO-1', recipe: 'standard', nodes: NODES },
    ready: ['N-1'],
    blocked: [],
    ...over,
  }
}

let invoke: ReturnType<typeof vi.fn>

function mount(view: Record<string, unknown>) {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') return view
    return { terminalSessionId: 't-1' }
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<Floor orderId="WO-1" />)
}

const TWO_LANES = [
  {
    ord: 1,
    repo: 'proto',
    role: 'producer',
    collisions: ['proto/session.proto'],
    blockedBy: [],
    hold: null,
  },
  {
    ord: 2,
    repo: 'cli-flow',
    role: 'consumer',
    collisions: ['proto/session.proto'],
    blockedBy: [1],
    hold: 'lane 1 (proto) must merge first — they share proto/session.proto',
  },
]

beforeEach(() => vi.clearAllMocks())

describe('the merge order section', () => {
  it('lists the repositories in the order they land', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => expect(screen.getByText('Merge order')).toBeTruthy())
    const items = screen.getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(items[0]).toContain('proto')
    expect(items[1]).toContain('cli-flow')
  })

  it('says which lane produces the shared change', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    expect(screen.getByText('producer')).toBeTruthy()
    expect(screen.getByText('consumer')).toBeTruthy()
  })

  it('names the file the lanes share, on both of them', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    expect(screen.getAllByText(/shares proto\/session\.proto/)).toHaveLength(2)
  })

  it("gives the rule's own reason for a hold, not a lane number", async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    expect(screen.getByText(/must merge first/)).toBeTruthy()
  })

  it('says a lane is free to merge when nothing holds it', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    expect(screen.getByText('free to merge')).toBeTruthy()
  })

  it('shows nothing at all for a single-repository order (FR-068)', async () => {
    mount(reply({ lanes: [{ ...TWO_LANES[0], collisions: [], role: null }] }))
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText('Merge order')).toBeNull()
  })

  it('shows nothing when the run predates lane reporting', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.queryByText('Merge order')).toBeNull()
  })
})

describe('the units', () => {
  it('names each row by its repository rather than by a lane number', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    // Twice each: once in the merge order, once as the unit row heading.
    expect(screen.getAllByText('proto')).toHaveLength(2)
    expect(screen.getAllByText('cli-flow')).toHaveLength(2)
  })

  it('falls back to the lane number when the order names no repository', async () => {
    mount(reply())
    await waitFor(() => screen.getByText(/WO-1/))
    expect(screen.getByText('lane 1')).toBeTruthy()
  })

  it('offers a way into a running agent session, and only a running one', async () => {
    mount(reply({ lanes: TWO_LANES }))
    await waitFor(() => screen.getByText('Merge order'))
    const buttons = screen.getAllByRole('button', { name: /^Attach to/ })
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Attach to N-1'])

    fireEvent.click(buttons[0])
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:session.attach', {
        orderId: 'WO-1',
        nodeId: 'N-1',
      })
    )
  })

  it('reports what is blocked and why', async () => {
    mount(reply({ blocked: [{ id: 'N-2', reason: 'N-1 has not passed' }] }))
    await waitFor(() => screen.getByText('Blocked'))
    expect(screen.getByText(/N-1 has not passed/)).toBeTruthy()
  })
})

describe('when there is no run', () => {
  it('says so rather than spinning', async () => {
    mount({ error: 'No run for WO-1.' })
    await waitFor(() => expect(screen.getByText('No run for WO-1.')).toBeTruthy())
  })
})
