import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { Forge } from '../../src/components/Forge.js'
import { draftOrder } from '../../src/order/schema.js'
import { compileOrder } from '../../src/order/compile.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The mapping panel (FR-060): which of the tracker's own states each moment
// means. Presented rather than assumed, because "In Review" is a decision
// about a workflow, not a fact about one.

const STATES = [
  { id: 'st-progress', name: 'In Progress', intent: 'started' as const, available: true },
  { id: 'st-review', name: 'In Review', intent: 'in_review' as const, available: true },
  { id: 'st-done', name: 'Done', intent: 'done' as const, available: true },
]

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-1',
      title: 'Refuse an expired refresh token',
      source: {
        kind: 'tracker',
        tracker: 'linear',
        key: 'TAV-42',
        url: 'https://linear.app/tav/issue/TAV-42',
      },
      repoPaths: ['/repos/app'],
      now: '2026-09-06T10:00:00.000Z',
    }),
    ...over,
  }
}

let invoke: ReturnType<typeof vi.fn>

function mount(statesReply: unknown, over: Partial<WorkOrder> = {}) {
  const current = order(over)
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:order.compile') {
      return { order: current, compile: compileOrder(current) }
    }
    if (channel === 'foundry:order.states') return statesReply
    if (channel === 'foundry:run.recipes') return { recipes: [], proposed: 'standard' }
    if (channel === 'foundry:order.converge')
      return { order: current, compile: compileOrder(current) }
    if (channel === 'foundry:order.mapState') {
      return { ok: true, mapping: { started: null, in_review: 'st-progress', done: null } }
    }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<Forge orderId="WO-1" />)
}

beforeEach(() => vi.clearAllMocks())

describe('the tracker write-back panel', () => {
  it('offers one row per moment in the order life', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await waitFor(() => expect(screen.getByText('Tracker write-back')).toBeTruthy())
    for (const label of ['When work starts', 'When the draft opens', 'When it merges']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('offers the tracker own states as the choices, by their own names', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await waitFor(() => screen.getByText('Tracker write-back'))
    expect(screen.getAllByRole('option', { name: 'In Review' })).toHaveLength(3)
  })

  it('defaults to letting the tracker resolve the intent', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await waitFor(() => screen.getByText('Tracker write-back'))
    expect(screen.getAllByRole('option', { name: 'let the tracker decide' })).toHaveLength(3)
  })

  it('stores the override when the operator picks one', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await waitFor(() => screen.getByText('Tracker write-back'))

    const select = screen.getAllByRole('combobox')[1]
    fireEvent.change(select, { target: { value: 'st-progress' } })

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.mapState', {
        id: 'WO-1',
        intent: 'in_review',
        optionId: 'st-progress',
      })
    )
  })

  it('puts an intent back to the tracker own resolution', async () => {
    mount({
      capability: { transitions: 'supported', states: STATES, unreachable: [] },
      mapping: { started: null, in_review: 'st-review', done: null },
    })
    await waitFor(() => screen.getByText('Tracker write-back'))

    fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value: '' } })
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.mapState', {
        id: 'WO-1',
        intent: 'in_review',
        optionId: null,
      })
    )
  })

  it('says the workflow has nowhere to go rather than offering a wrong state', async () => {
    mount({
      capability: {
        transitions: 'supported',
        states: STATES.filter((s) => s.intent !== 'in_review'),
        unreachable: ['in_review'],
      },
    })
    await waitFor(() => screen.getByText('Tracker write-back'))
    expect(screen.getByRole('option', { name: 'nowhere to go — skipped' })).toBeTruthy()
  })

  it('says the tracker cannot be moved at all, and what still works', async () => {
    mount({ capability: { transitions: 'unsupported', states: [], unreachable: [] } })
    await waitFor(() => screen.getByText('Tracker write-back'))
    expect(screen.getByText(/cannot be asked to move an issue/)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('shows no panel at all for an order nobody seeded from a tracker', async () => {
    mount({ capability: { transitions: 'no_issue', states: [], unreachable: [] } })
    await waitFor(() => screen.getByText('Refuse an expired refresh token'))
    expect(screen.queryByText('Tracker write-back')).toBeNull()
  })

  it('shows no panel when the states channel answered with nothing', async () => {
    mount({})
    await waitFor(() => screen.getByText('Refuse an expired refresh token'))
    expect(screen.queryByText('Tracker write-back')).toBeNull()
  })

  it('asks the tracker once, not on every redraw', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await waitFor(() => screen.getByText('Tracker write-back'))
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:order.states')).toHaveLength(1)
  })
})

/** A Forge over an order that will compile, so hand-off actually runs. */
function mountForStart(over: Record<string, unknown> = {}) {
  const current = {
    ...order(),
    acceptance: [
      {
        id: 'AC-1',
        statement: 'a',
        priority: 'P1' as const,
        verify: { kind: 'test' as const, command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    intent: { problem: 'p', outcome: 'o', nonGoals: [] },
    risk: { grade: 'P2' as const, triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    plan: {
      ...order().plan,
      units: [
        {
          id: 'U-1',
          title: 'a',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/a.ts'],
          verify: [],
        },
      ],
    },
  }
  const onStarted = vi.fn()
  invoke = vi.fn(async (channel: string, payload: unknown) => {
    if (channel === 'foundry:order.compile') {
      const commit = (payload as { commit?: boolean }).commit === true
      const shown = commit ? { ...current, status: 'agreed' as const } : current
      return { order: shown, compile: compileOrder(shown) }
    }
    if (channel === 'foundry:order.states') return {}
    if (channel === 'foundry:run.recipes') {
      return (
        over.recipes ?? {
          recipes: [
            { name: 'direct', available: true, unmet: [], rung: 'built-in' },
            { name: 'standard', available: true, unmet: [], rung: 'built-in' },
            {
              name: 'speckit',
              available: false,
              unmet: ['this repository has no SpecKit skills'],
              rung: 'built-in',
            },
          ],
          proposed: 'standard',
        }
      )
    }
    if (channel === 'foundry:run.start') return over.start ?? { ok: true }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<Forge orderId="WO-1" onStarted={onStarted} />)
  return onStarted
}

describe('handing off', () => {
  it('starts the Line, rather than leaving the order agreed and idle', async () => {
    mountForStart()
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:run.start', { id: 'WO-1' }))
  })

  it('tells the caller the run began, so the surface can swap to the Floor', async () => {
    const onStarted = mountForStart()
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('WO-1'))
  })

  it('says the order is agreed even when the run refused to start', async () => {
    const onStarted = mountForStart({ start: { error: 'this repository has no test command' } })
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    await waitFor(() => expect(screen.getByText(/agreed, but the run did not start/)).toBeTruthy())
    expect(screen.getByText(/no test command/)).toBeTruthy()
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('starts nothing for an order that did not compile', async () => {
    mount({ capability: { transitions: 'no_issue', states: [], unreachable: [] } })
    await waitFor(() => screen.getByRole('button', { name: /Blocked by/ }))
    expect(screen.getByRole('button', { name: /Blocked by/ }).hasAttribute('disabled')).toBe(true)
  })
})

describe('choosing the shape of work', () => {
  it('offers the shapes this repository can support, marking the proposal', async () => {
    mountForStart()
    await waitFor(() => expect(screen.getByText('Shape of work')).toBeTruthy())
    expect(screen.getByText('direct')).toBeTruthy()
    expect(screen.getByText('proposed')).toBeTruthy()
  })

  it('shows one it cannot run, with the requirement it does not meet', async () => {
    mountForStart()
    await waitFor(() => screen.getByText('Shape of work'))
    expect(screen.getByText(/no SpecKit skills/)).toBeTruthy()
  })

  it('will not let one it cannot run be chosen', async () => {
    mountForStart()
    await waitFor(() => screen.getByText('Shape of work'))
    const speckit = screen.getByText('speckit').closest('button')
    expect(speckit?.hasAttribute('disabled')).toBe(true)
  })

  it('starts with the proposal when the operator says nothing', async () => {
    mountForStart()
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:run.start', { id: 'WO-1' }))
  })

  it("carries the operator's own choice when they make one", async () => {
    mountForStart()
    await waitFor(() => screen.getByText('Shape of work'))
    fireEvent.click(screen.getByText('direct').closest('button') as HTMLElement)
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run.start', { id: 'WO-1', recipe: 'direct' })
    )
  })

  it('offers nothing when the repository supports no shape at all', async () => {
    mountForStart({ recipes: { recipes: [], proposed: '' } })
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    expect(screen.queryByText('Shape of work')).toBeNull()
  })
})

describe('drafting the plan', () => {
  it('offers the action, because nothing else writes the criteria', async () => {
    mount({ capability: { transitions: 'no_issue', states: [], unreachable: [] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Draft the plan/ })).toBeTruthy())
    expect(screen.getByText(/Nothing writes them but the architect/)).toBeTruthy()
  })

  it('asks the architect for one', async () => {
    mount({ capability: { transitions: 'no_issue', states: [], unreachable: [] } })
    await waitFor(() => screen.getByRole('button', { name: /Draft the plan/ }))
    fireEvent.click(screen.getByRole('button', { name: /Draft the plan/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', { id: 'WO-1' })
    )
  })

  it('sends what the operator typed to the architect', async () => {
    mount({ capability: { transitions: 'no_issue', states: [], unreachable: [] } })
    await waitFor(() => screen.getByLabelText(/Tell the architect/))

    fireEvent.change(screen.getByLabelText(/Tell the architect/), {
      target: { value: 'the second unit is not needed' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', {
        id: 'WO-1',
        message: 'the second unit is not needed',
      })
    )
  })

  it('says why intake refused, rather than looking as though nothing happened', async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: order(), compile: compileOrder(order()) }
      }
      if (channel === 'foundry:order.converge') {
        return {
          order: order(),
          compile: compileOrder(order()),
          error: 'the proposal reached for a status',
        }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)

    await waitFor(() => screen.getByRole('button', { name: /Draft the plan/ }))
    fireEvent.click(screen.getByRole('button', { name: /Draft the plan/ }))
    await waitFor(() => expect(screen.getByText('the proposal reached for a status')).toBeTruthy())
  })

  it('offers a redraft once there are criteria', async () => {
    const withCriteria = {
      ...order(),
      acceptance: [
        {
          id: 'AC-1',
          statement: 'a',
          priority: 'P1' as const,
          verify: { kind: 'test' as const, command: 'npm test', assert: 'exit_code == 0' },
          unverifiable: null,
        },
      ],
    }
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: withCriteria, compile: compileOrder(withCriteria) }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Redraft/ })).toBeTruthy())
  })

  it('offers neither once the order has been handed off', async () => {
    const running = { ...order(), status: 'running' as const }
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: running, compile: compileOrder(running) }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
    await waitFor(() => screen.getByText(/Handed off/))
    expect(screen.queryByRole('button', { name: /Draft the plan|Redraft/ })).toBeNull()
  })
})

describe('only the parts affected are redrawn (FR-007)', () => {
  function withChanged(changed: string[]) {
    const current = {
      ...order(),
      assumptions: [
        { id: 'A-1', text: 'sessions are stored in Redis', struck: false, affects: ['AC-1'] },
      ],
    }
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: current, compile: compileOrder(current) }
      }
      if (channel === 'foundry:order.turn') {
        return { order: current, compile: compileOrder(current), changed }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  it('marks what a struck assumption moved, and nothing else', async () => {
    withChanged(['acceptance'])
    await waitFor(() => screen.getByText(/sessions are stored in Redis/))

    // Striking one goes through `turn`, which is what carries the redraw list.
    fireEvent.click(
      screen.getByText(/sessions are stored in Redis/).closest('button') as HTMLElement
    )
    await waitFor(() =>
      expect(screen.getByText(/Acceptance/).closest('section')?.className).toContain('is-redrawn')
    )
    expect(screen.getByText('Intent').closest('section')?.className).not.toContain('is-redrawn')
  })

  it('marks nothing when nothing moved', async () => {
    withChanged([])
    await waitFor(() => screen.getByText(/sessions are stored in Redis/))
    fireEvent.click(
      screen.getByText(/sessions are stored in Redis/).closest('button') as HTMLElement
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.turn', expect.anything())
    )
    expect(screen.getByText('Intent').closest('section')?.className).not.toContain('is-redrawn')
  })
})

describe('clearing an adversarial finding', () => {
  function withFinding() {
    const current = {
      ...order(),
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high' as const,
          text: 'the outcome restates the problem',
          status: 'open' as const,
          reason: '',
        },
      ],
    }
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: current, compile: compileOrder(current) }
      }
      if (channel === 'foundry:order.turn') {
        return { order: current, compile: compileOrder(current) }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  it('offers a way to clear it, not just a list of what is blocking', async () => {
    withFinding()
    await waitFor(() => expect(screen.getByText(/Red team — 1 open/)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Fixed' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept' })).toBeTruthy()
  })

  it('marks one fixed', async () => {
    withFinding()
    await waitFor(() => screen.getByText(/Red team — 1 open/))
    fireEvent.click(screen.getByRole('button', { name: 'Fixed' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.turn', {
        id: 'WO-1',
        finding: { id: 'RT-1', decision: 'resolved' },
      })
    )
  })

  it('asks for the reason before accepting one', async () => {
    withFinding()
    await waitFor(() => screen.getByText(/Red team — 1 open/))
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(screen.getByLabelText(/Why this finding is accepted/)).toBeTruthy())

    // Nothing is sent until there is one — a shrug is not a decision.
    fireEvent.click(screen.getByRole('button', { name: 'Accept it' }))
    expect(invoke).not.toHaveBeenCalledWith('foundry:order.turn', expect.anything())

    fireEvent.change(screen.getByLabelText(/Why this finding is accepted/), {
      target: { value: 'the risk is priced in' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Accept it' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.turn', {
        id: 'WO-1',
        finding: { id: 'RT-1', decision: 'accepted', reason: 'the risk is priced in' },
      })
    )
  })
})
