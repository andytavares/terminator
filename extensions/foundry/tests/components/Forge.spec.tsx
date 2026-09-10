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
/** What `foundry:run-terminal` answers. Reset before every test. */
let terminalReply: unknown = { ok: true }

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
    if (channel === 'foundry:order.writeBack') {
      return { order: current, compile: compileOrder(current) }
    }
    if (channel === 'foundry:order.mapState') {
      return { ok: true, mapping: { started: null, in_review: 'st-progress', done: null } }
    }
    if (channel === 'foundry:run-terminal') return terminalReply
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<Forge orderId="WO-1" />)
}

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn()

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
          proposedWhy: '2 units of work',
        }
      )
    }
    if (channel === 'foundry:run.start') {
      // A function when the answer depends on the payload — the override sends
      // `force: true` and must get a different reply from the refusal.
      return typeof over.start === 'function'
        ? (over.start as (p: unknown) => unknown)(payload)
        : (over.start ?? { ok: true })
    }
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

  it('says why that shape was proposed, not only that it was (FR-014)', async () => {
    mountForStart()
    await waitFor(() => screen.getByText('Shape of work'))
    expect(screen.getByText(/standard proposed — 2 units of work/)).toBeTruthy()
  })

  it('says nothing about grounds it was not given', async () => {
    mountForStart({
      recipes: {
        recipes: [{ name: 'direct', available: true, unmet: [], rung: 'built-in' }],
        proposed: 'direct',
      },
    })
    await waitFor(() => screen.getByText('Shape of work'))
    expect(screen.queryByText(/proposed —/)).toBeNull()
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
    // This order came from a ticket, and a ticket that names its criteria has
    // them lifted at intake. Saying "no criteria yet" to somebody who had just
    // written a heading called "Acceptance Criteria" read as the tool ignoring
    // the ticket, so it says which ticket it looked in.
    expect(screen.getByText(/Nothing under an acceptance heading in TAV-42/)).toBeTruthy()
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

describe('while the architect is working', () => {
  /**
   * A ledger that turns over after `polls` reads.
   *
   * The channel's `intake` field, not `provenance.decisions`, because a turn
   * can end without the document moving at all — which is what a refusal is,
   * and what the old fixture could not express.
   */
  function landsAfter(polls: number, ending: Record<string, unknown>) {
    let reads = 0
    let started = false
    const before = order()
    const running = { kind: 'running', at: '2026-09-09T19:30:00Z', sessionId: 'sess-arch' }
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        // Before the click there is no turn, which is what the mount read
        // sees; after it, `polls` reads of a turn in flight and then its end.
        if (!started)
          return { order: before, compile: compileOrder(before), intake: { kind: 'none' } }
        reads += 1
        return {
          order: before,
          compile: compileOrder(before),
          intake: reads > polls ? ending : running,
        }
      }
      if (channel === 'foundry:order.converge') {
        started = true
        return {
          order: before,
          compile: compileOrder(before),
          converging: 'sess-arch',
          intake: running,
        }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  const REDRAFTED = { kind: 'redrafted', at: '2026-09-09T19:33:00Z', note: 'redrafted the plan' }
  const REFUSED = {
    kind: 'refused',
    at: '2026-09-09T19:33:21Z',
    reason: "acceptance.5.verify.evidence.1: Invalid enum value. Expected 'exit_code' | 'stdout'",
  }

  it('keeps asking until the redraft lands, rather than giving up after one tick', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    landsAfter(3, REDRAFTED)
    await vi.waitFor(() =>
      expect(screen.getByRole('button', { name: /Draft the plan/ })).toBeTruthy()
    )

    fireEvent.click(screen.getByRole('button', { name: /Draft the plan/ }))
    await vi.waitFor(() => expect(screen.getByText(/The architect is working/)).toBeTruthy())

    // Three polls before the turn ends. A poll that stopped after one would
    // never see it.
    await vi.advanceTimersByTimeAsync(12_000)
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter((c) => c[0] === 'foundry:order.compile').length
      ).toBeGreaterThan(4)
    )
    vi.useRealTimers()
  })

  it('stops once the architect has written its line', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    landsAfter(1, REDRAFTED)
    await vi.waitFor(() => screen.getByRole('button', { name: /Draft the plan/ }))
    fireEvent.click(screen.getByRole('button', { name: /Draft the plan/ }))
    await vi.advanceTimersByTimeAsync(9_000)

    await vi.waitFor(() => expect(screen.queryByText(/The architect is working/)).toBeNull())
    const settled = invoke.mock.calls.filter((c) => c[0] === 'foundry:order.compile').length
    await vi.advanceTimersByTimeAsync(9_000)
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:order.compile').length).toBe(settled)
    vi.useRealTimers()
  })

  // The reported bug, whole. A refusal saves nothing, so the document is
  // byte-for-byte what it was — and the stop condition used to be the document
  // growing. The button read "The architect is working…" over a turn that had
  // ended forty minutes earlier, and the poll never stopped.
  it('stops when the turn was refused, though nothing was saved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    landsAfter(1, REFUSED)
    await vi.waitFor(() => screen.getByRole('button', { name: /Draft the plan/ }))
    fireEvent.click(screen.getByRole('button', { name: /Draft the plan/ }))
    await vi.advanceTimersByTimeAsync(9_000)

    await vi.waitFor(() => expect(screen.queryByText(/The architect is working/)).toBeNull())
    const settled = invoke.mock.calls.filter((c) => c[0] === 'foundry:order.compile').length
    await vi.advanceTimersByTimeAsync(9_000)
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:order.compile').length).toBe(settled)
    vi.useRealTimers()
  })
})

describe('a turn that was refused', () => {
  const REFUSED = {
    kind: 'refused',
    at: '2026-09-09T19:33:21Z',
    reason: "acceptance.5.verify.evidence.1: Invalid enum value. Expected 'exit_code' | 'stdout'",
  }

  function refused() {
    const shown = order()
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: shown, compile: compileOrder(shown), intake: REFUSED }
      }
      if (channel === 'foundry:order.converge') {
        return {
          order: shown,
          compile: compileOrder(shown),
          converging: 'sess-arch',
          intake: { kind: 'running', at: '2026-09-09T19:40:00Z', sessionId: 'sess-arch' },
        }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  it('says so, and says why, in the validator\u2019s own words', async () => {
    refused()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /plan was refused/i })).toBeTruthy()
    )
    expect(screen.getByText(/Invalid enum value/)).toBeTruthy()
    expect(screen.getByText(/Nothing on this order was changed/)).toBeTruthy()
  })

  // A screen that names a problem and offers no reachable control is a wall.
  // The reason goes back with the ask because the architect cannot read its
  // own refusal: its turn ended before the validation ran.
  it('carries the reason back to the architect', async () => {
    refused()
    await waitFor(() => screen.getByRole('heading', { name: /plan was refused/i }))
    fireEvent.click(screen.getByRole('button', { name: /Tell the architect what was wrong/ }))

    await waitFor(() => {
      const call = invoke.mock.calls.find((c) => c[0] === 'foundry:order.converge')
      expect(call).toBeTruthy()
      const message = String((call?.[1] as { message?: string }).message ?? '')
      expect(message).toContain('Invalid enum value')
      expect(message).toContain('proposal.json')
    })
  })

  it('can also start the turn over, carrying nothing', async () => {
    refused()
    await waitFor(() => screen.getByRole('heading', { name: /plan was refused/i }))
    fireEvent.click(screen.getByRole('button', { name: /Start the turn over/ }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', { id: 'WO-1' })
    )
  })
})

describe('what this order writes back (FR-062)', () => {
  it('offers each write-back, checked from the order', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await waitFor(() => screen.getByText('Tracker write-back'))
    expect(screen.getByLabelText(/The agreed order, as a comment/)).toBeTruthy()
    expect(screen.getByLabelText(/Move its workflow state/)).toBeTruthy()
    expect(screen.getByLabelText(/The pull request links/)).toBeTruthy()
  })

  it('turns one on for this order alone', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await waitFor(() => screen.getByText('Tracker write-back'))
    fireEvent.click(screen.getByLabelText(/Move its workflow state/))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.writeBack', {
        id: 'WO-1',
        writeBack: ['status'],
      })
    )
  })
})

// The way back into the conversation that wrote the plan. It was a prop, and
// nothing ever passed it, so the control never appeared in the running
// application — while `provenance.forgeSession`, the thing it needed, was
// never written either.
describe('attaching to the architect', () => {
  beforeEach(() => {
    terminalReply = { ok: true }
  })

  it('offers the way back into the conversation that wrote the plan', async () => {
    mount({}, { provenance: { forgeSession: 'sess-architect', decisions: [], amendments: [] } })
    await waitFor(() => expect(screen.getByRole('button', { name: /Attach/ })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Attach/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-terminal', { sessionId: 'sess-architect' })
    )
  })

  it('offers nothing for an order no architect has run on', async () => {
    mount({})
    await waitFor(() => screen.getByRole('button', { name: /Compile|Blocked by/ }))
    expect(screen.queryByRole('button', { name: /Attach/ })).toBeNull()
  })

  it('says so when that conversation has no terminal left', async () => {
    terminalReply = { ok: false }
    mount({}, { provenance: { forgeSession: 'sess-gone', decisions: [], amendments: [] } })
    await waitFor(() => screen.getByRole('button', { name: /Attach/ }))
    fireEvent.click(screen.getByRole('button', { name: /Attach/ }))
    await waitFor(() => expect(screen.getByText(/no longer has a terminal/)).toBeTruthy())
  })
})

// The one refusal the operator can answer: it is about their own review queue,
// not about the order. `SUPERVISION.md` has always promised "**Start anyway**
// next to it", and there was no such control.
describe('a start held back by the review queue', () => {
  const refuse = (payload: unknown) =>
    (payload as { force?: boolean }).force === true
      ? { ok: true }
      : {
          error: '3 finished sessions are waiting for review, and the limit is 3.',
          backpressure: { unreviewed: 3, limit: 3 },
        }

  it('says why the run did not start', async () => {
    mountForStart({ start: refuse })
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    // Twice on purpose: once as the refusal, once on the override that answers
    // it. The message is what matters here.
    await waitFor(() => expect(screen.getAllByText(/waiting for review/).length).toBeGreaterThan(0))
    expect(screen.getByText(/the run did not start/)).toBeTruthy()
  })

  it('offers the override, naming what is waiting', async () => {
    mountForStart({ start: refuse })
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Start anyway — 3 waiting/ })).toBeTruthy()
    )
  })

  it('starts it when the operator takes the override', async () => {
    mountForStart({ start: refuse })
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    await waitFor(() => screen.getByRole('button', { name: /Start anyway/ }))
    fireEvent.click(screen.getByRole('button', { name: /Start anyway/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'foundry:run.start',
        expect.objectContaining({ force: true })
      )
    )
  })

  it('offers no override for a refusal that is not about the queue', async () => {
    mountForStart({ start: { error: 'this repository has no test command' } })
    await waitFor(() => screen.getByRole('button', { name: /Compile/ }))
    fireEvent.click(screen.getByRole('button', { name: /Compile/ }))
    await waitFor(() => screen.getByText(/no test command/))
    expect(screen.queryByRole('button', { name: /Start anyway/ })).toBeNull()
  })
})

// Every failing check names a move.
//
// Five of the six said what was wrong and stopped. `verifiable` was the worst
// of them: its own failure text names an escape — accept the criterion as
// unverifiable, in writing — that no control on this screen could reach, so an
// operator whose plan changed something a person sees had a red mark and
// nothing to press.

/** A draft whose only failing check is the one the operator reported. */
function orderBlockedOnPictures() {
  return {
    ...order(),
    acceptance: [
      {
        id: 'AC-1',
        statement: 'the row does not clip its last glyph',
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
          title: 'redraw the row',
          role: 'builder',
          lane: 1,
          dependsOn: [],
          satisfies: ['AC-1'],
          touches: ['src/components/Row.tsx'],
          verify: [],
        },
      ],
    },
  }
}

function mountBlocked(over: Record<string, unknown> = {}) {
  const current = { ...orderBlockedOnPictures(), ...over }
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:order.compile') {
      return { order: current, compile: compileOrder(current) }
    }
    if (channel === 'foundry:order.turn') {
      return { order: current, compile: compileOrder(current), changed: ['acceptance'] }
    }
    if (channel === 'foundry:order.converge') {
      return { order: current, compile: compileOrder(current), converging: 'sess-1' }
    }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  render(<Forge orderId="WO-1" />)
  return current
}

describe('a failing check says how to clear it', () => {
  it('shows the falsifiable check failing, on the case an operator actually meets', async () => {
    mountBlocked()
    await waitFor(() => expect(screen.getByText(/no criterion asks for a picture/)).toBeTruthy())
  })

  it('offers to ask the architect for proof', async () => {
    mountBlocked()
    await waitFor(() => screen.getByRole('button', { name: 'Ask for proof' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ask for proof' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'foundry:order.converge',
        expect.objectContaining({ id: 'WO-1', message: expect.stringContaining('screenshot') })
      )
    )
  })

  it('offers the written escape, and takes the operator to it', async () => {
    mountBlocked()
    await waitFor(() => screen.getByRole('button', { name: /Or mark one unprovable/ }))
    fireEvent.click(screen.getByRole('button', { name: /Or mark one unprovable/ }))
    // The heading it lands on is the one the acceptance list sits under.
    expect(document.getElementById('fdry-acceptance')).not.toBeNull()
  })

  it('accepts a criterion as unverifiable, with a reason', async () => {
    mountBlocked()
    await waitFor(() => screen.getByRole('button', { name: 'Nothing here can prove this' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nothing here can prove this' }))

    const box = screen.getByLabelText('Why AC-1 cannot be proven')
    fireEvent.change(box, { target: { value: 'there is no display in this environment' } })
    fireEvent.click(screen.getByRole('button', { name: 'Accept it' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.turn', {
        id: 'WO-1',
        unverifiable: {
          criterionId: 'AC-1',
          reason: 'there is no display in this environment',
        },
      })
    )
  })

  it('will not accept one on a blank reason — a shrug is not a decision', async () => {
    mountBlocked()
    await waitFor(() => screen.getByRole('button', { name: 'Nothing here can prove this' }))
    fireEvent.click(screen.getByRole('button', { name: 'Nothing here can prove this' }))
    expect(screen.getByRole('button', { name: 'Accept it' }).hasAttribute('disabled')).toBe(true)
  })

  it('renders the reason once it is accepted, instead of offering it again', async () => {
    const accepted = orderBlockedOnPictures()
    mountBlocked({
      acceptance: [
        {
          ...accepted.acceptance[0],
          unverifiable: { accepted: true as const, reason: 'no display in this environment' },
        },
      ],
    })
    await waitFor(() =>
      expect(
        screen.getByText(/accepted as unverifiable — no display in this environment/)
      ).toBeTruthy()
    )
    expect(screen.queryByRole('button', { name: 'Nothing here can prove this' })).toBeNull()
  })

  it('sends the open questions to the band rather than to the architect', async () => {
    mountBlocked({
      openQuestions: [
        {
          id: 'Q-1',
          text: 'which token?',
          why: 'the repository does not say',
          options: ['a', 'b'],
          recommended: 0,
          answer: null,
          rank: 1,
        },
      ],
    })
    await waitFor(() => screen.getByRole('button', { name: 'Answer them' }))
    fireEvent.click(screen.getByRole('button', { name: 'Answer them' }))
    expect(invoke).not.toHaveBeenCalledWith('foundry:order.converge', expect.anything())
  })

  it('offers no remedy on a check that passes', async () => {
    mountBlocked()
    await waitFor(() => screen.getByText('Convergence'))
    // Risk is graded against this plan, so its row carries no button.
    expect(screen.queryByRole('button', { name: 'Ask for a regrade' })).toBeNull()
  })

  it('offers no remedy at all once the order has been handed off', async () => {
    mountBlocked({ status: 'running' as const })
    await waitFor(() => screen.getByText('Convergence'))
    expect(screen.queryByRole('button', { name: 'Ask for proof' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Nothing here can prove this' })).toBeNull()
  })
})
