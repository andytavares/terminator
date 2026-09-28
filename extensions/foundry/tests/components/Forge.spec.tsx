import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { Forge } from '../../src/components/Forge.js'
import { draftOrder } from '../../src/order/draft.js'
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

/** The step list, where every step of the Forge is reached. */
function stepList(): HTMLElement {
  return screen.getByRole('navigation', { name: 'Steps' })
}

/** Go to a step by the name the step list shows, once it is offered. */
async function openStep(name: string): Promise<void> {
  const label = new RegExp(`^${name}`)
  await waitFor(() => within(stepList()).getByRole('button', { name: label }))
  fireEvent.click(within(stepList()).getByRole('button', { name: label }))
}

/**
 * Whether a control is unavailable, the ReasonButton way (ADR 074): it stays
 * a real `<button>`, never the native `disabled`, so `aria-disabled` is the
 * one true signal.
 */
function isUnavailable(el: HTMLElement): boolean {
  return el.getAttribute('aria-disabled') === 'true'
}

/** The reason an unavailable control names, via its `aria-describedby`. */
function reasonFor(el: HTMLElement): string {
  const id = el.getAttribute('aria-describedby')
  expect(id).not.toBeNull()
  const tip = document.getElementById(id as string)
  expect(tip).not.toBeNull()
  return tip?.textContent ?? ''
}

// The Hand off step's own rail button is also named "Hand off", so the
// footer's submit control has to be found scoped to the footer.
function footer(): HTMLElement {
  return document.querySelector('.fdry-foot') as HTMLElement
}
function handOffButton(): HTMLElement {
  return within(footer()).getByRole('button', { name: /Hand off/ })
}
function queryHandOffButton(): HTMLElement | null {
  const f = document.querySelector('.fdry-foot')
  return f === null ? null : within(f as HTMLElement).queryByRole('button', { name: /Hand off/ })
}

beforeEach(() => vi.clearAllMocks())

describe('the tracker write-back panel', () => {
  it('offers one row per moment in the order life', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await openStep('Tracker')
    expect(screen.getByRole('heading', { name: 'Tracker write-back' })).toBeTruthy()
    for (const label of ['When work starts', 'When the draft opens', 'When it merges']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
  })

  it('offers the tracker own states as the choices, by their own names', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await openStep('Tracker')
    expect(screen.getAllByRole('option', { name: 'In Review' })).toHaveLength(3)
  })

  it('defaults to letting the tracker resolve the intent', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await openStep('Tracker')
    expect(screen.getAllByRole('option', { name: 'let the tracker decide' })).toHaveLength(3)
  })

  it('stores the override when the operator picks one', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await openStep('Tracker')

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
    await openStep('Tracker')

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
    await openStep('Tracker')
    expect(screen.getByRole('option', { name: 'nowhere to go — skipped' })).toBeTruthy()
  })

  it('says the tracker cannot be moved at all, and what still works', async () => {
    mount({ capability: { transitions: 'unsupported', states: [], unreachable: [] } })
    await openStep('Tracker')
    expect(screen.getByText(/cannot be asked to move an issue/)).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('offers no step at all for an order nobody seeded from a tracker', async () => {
    mount({ capability: { transitions: 'no_issue', states: [], unreachable: [] } })
    await waitFor(() => screen.getByText('Refuse an expired refresh token'))
    expect(within(stepList()).queryByRole('button', { name: /^Tracker/ })).toBeNull()
  })

  it('offers no step when the states channel answered with nothing', async () => {
    mount({})
    await waitFor(() => screen.getByText('Refuse an expired refresh token'))
    expect(within(stepList()).queryByRole('button', { name: /^Tracker/ })).toBeNull()
  })

  it('asks the tracker once, not on every redraw', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await openStep('Tracker')
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:order.states')).toHaveLength(1)
  })
})

// The header chip no longer links to the signal's evidence url — the
// redesign dropped it, leaving only the plain "From a sensor signal" chip.
describe('an order seeded from a sensor signal', () => {
  it('says where it came from', async () => {
    mount(
      {},
      {
        source: {
          kind: 'signal',
          tracker: null,
          key: 'SIG-1',
          url: 'https://ci.example/42',
        },
      }
    )
    await waitFor(() => screen.getByText('Refuse an expired refresh token'))
    expect(screen.getByText('From a sensor signal')).toBeTruthy()
  })

  it('shows no chip at all for a typed order', async () => {
    mount({}, { source: { kind: 'typed', tracker: null, key: null, url: null } })
    await waitFor(() => screen.getByText('Refuse an expired refresh token'))
    expect(screen.queryByText('From a sensor signal')).toBeNull()
    expect(document.querySelector('.fdry-chip')).toBeNull()
  })
})

/** A Forge over an order that will compile, so hand-off actually runs. */
function mountForStart(over: Record<string, unknown> = {}) {
  let chosen: string | null = null
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
      return {
        order: shown,
        compile: compileOrder(shown),
        ...(over.intake === undefined
          ? {}
          : { intake: typeof over.intake === 'function' ? over.intake() : over.intake }),
        ...(commit ? { advisory: (over.advisory as string | null | undefined) ?? null } : {}),
      }
    }
    if (channel === 'foundry:order.states') return {}
    // As the backend does: the pick is saved to the order and read back.
    if (channel === 'foundry:order.recipe') {
      chosen = (payload as { recipe: string | null }).recipe
      return {}
    }
    if (channel === 'foundry:run.recipes') {
      return (
        over.recipes ?? {
          chosen,
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
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:run.start', { id: 'WO-1' }))
  })

  it('tells the caller the run began, so the surface can swap to the Floor', async () => {
    const onStarted = mountForStart()
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith('WO-1'))
  })

  it('says the order is agreed even when the run refused to start', async () => {
    const onStarted = mountForStart({ start: { error: 'this repository has no test command' } })
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    await waitFor(() => expect(screen.getByText(/agreed, but the run did not start/)).toBeTruthy())
    expect(screen.getByText(/no test command/)).toBeTruthy()
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('starts nothing for an order that did not compile', async () => {
    mount({ capability: { transitions: 'no_issue', states: [], unreachable: [] } })
    await openStep('Hand off')
    const button = await screen.findByRole('button', { name: 'Hand off' })
    expect(isUnavailable(button)).toBe(true)
    expect(reasonFor(button)).not.toBe('')
    fireEvent.click(button)
    expect(invoke).not.toHaveBeenCalledWith('foundry:run.start', expect.anything())
  })

  it('shows the refinery advisory as a note, once agreeing returns one (R4/R5)', async () => {
    mountForStart({ advisory: 'This queues behind WO-2 on src/a.ts.' })
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    const note = await screen.findByText('This queues behind WO-2 on src/a.ts.')
    expect(note.className).toContain('fdry-note')
    expect(note.className).not.toContain('fdry-problem')
  })

  it('says nothing about the refinery when nothing was queued', async () => {
    mountForStart()
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    await waitFor(() => expect(screen.getAllByText(/Handed off/).length).toBeGreaterThan(0))
    expect(screen.queryByText(/queues behind/)).toBeNull()
  })
})

describe('choosing the shape of work', () => {
  it('offers the shapes this repository can support, marking the proposal', async () => {
    mountForStart()
    await openStep('Shape')
    expect(screen.getByRole('heading', { name: 'Shape of work' })).toBeTruthy()
    expect(screen.getByText('Direct')).toBeTruthy()
    expect(screen.getByText('Proposed')).toBeTruthy()
  })

  it('says why that shape was proposed, not only that it was (FR-014)', async () => {
    mountForStart()
    await openStep('Shape')
    expect(screen.getByText(/Standard is proposed: 2 units of work/)).toBeTruthy()
  })

  it('says nothing about grounds it was not given', async () => {
    mountForStart({
      recipes: {
        recipes: [{ name: 'direct', available: true, unmet: [], rung: 'built-in' }],
        proposed: 'direct',
      },
    })
    await openStep('Shape')
    expect(screen.queryByText(/units of work/)).toBeNull()
  })

  it('shows one it cannot run, with the requirement it does not meet', async () => {
    mountForStart()
    await openStep('Shape')
    expect(screen.getAllByText(/no SpecKit skills/).length).toBeGreaterThan(0)
  })

  it('will not let one it cannot run be chosen', async () => {
    mountForStart()
    await openStep('Shape')
    const speckit = screen.getByText('Speckit').closest('button') as HTMLElement
    expect(isUnavailable(speckit)).toBe(true)
    expect(reasonFor(speckit)).toContain('no SpecKit skills')
  })

  it('starts with the proposal when the operator says nothing', async () => {
    mountForStart()
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:run.start', { id: 'WO-1' }))
  })

  it("carries the operator's own choice when they make one", async () => {
    mountForStart()
    await openStep('Shape')
    fireEvent.click(screen.getByText('Direct').closest('button') as HTMLElement)
    await openStep('Hand off')
    fireEvent.click(handOffButton())
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run.start', { id: 'WO-1', recipe: 'direct' })
    )
  })

  it('offers nothing when the repository supports no shape at all', async () => {
    mountForStart({ recipes: { recipes: [], proposed: '' } })
    await waitFor(() => handOffButton())
    expect(within(stepList()).queryByRole('button', { name: /^Shape/ })).toBeNull()
  })

  // A turn that never finishes must not lock every shape but the proposal:
  // the operator can always override it, whether or not the architect is
  // still working. The pick is saved to the order as it is made, so hand-off
  // — the operator's or the automatic one — runs it.
  it('lets an available shape be chosen while an intake turn is running, and hand-off carries it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const running = {
      kind: 'running' as const,
      at: '2026-09-06T10:00:00.000Z',
      sessionId: 'S-1',
      asked: '',
      actor: 'architect' as const,
      trigger: 'you' as const,
      round: null,
      autoTurn: null,
    }
    const ended = { kind: 'redrafted' as const, at: '2026-09-06T10:01:00.000Z', note: 'redrafted' }
    let polls = 0
    mountForStart({
      intake: () => {
        polls += 1
        return polls > 1 ? ended : running
      },
    })
    await openStep('Shape')
    const direct = screen.getByText('Direct').closest('button') as HTMLElement
    expect(isUnavailable(direct)).toBe(false)
    expect(direct.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(direct)
    await vi.waitFor(() =>
      expect(
        (screen.getByText('Direct').closest('button') as HTMLElement).getAttribute('aria-pressed')
      ).toBe('true')
    )

    await vi.advanceTimersByTimeAsync(3000)
    await openStep('Hand off')
    await vi.waitFor(() => expect(isUnavailable(handOffButton())).toBe(false))
    fireEvent.click(handOffButton())
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run.start', { id: 'WO-1', recipe: 'direct' })
    )
    vi.useRealTimers()
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

  it('offers a draft, not a redraft, when a ticket brought criteria and no units', async () => {
    const seeded = {
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
        return { order: seeded, compile: compileOrder(seeded) }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Draft the plan/ })).toBeTruthy())
    expect(screen.queryByRole('button', { name: /Redraft/ })).toBeNull()
  })

  it('offers a redraft once there is a plan', async () => {
    const withCriteria = {
      ...order(),
      plan: {
        ...order().plan,
        units: [
          {
            id: 'U-1',
            title: 'u',
            role: 'builder' as const,
            lane: 1,
            dependsOn: [],
            satisfies: ['AC-1'],
            touches: [],
            verify: [],
          },
        ],
      },
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
    await waitFor(() => expect(screen.getAllByText(/Handed off/).length).toBeGreaterThan(0))
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
    await openStep('Plan')
    await waitFor(() => screen.getByText(/sessions are stored in Redis/))

    // Striking one goes through `turn`, which is what carries the redraw list.
    fireEvent.click(
      screen.getByText(/sessions are stored in Redis/).closest('button') as HTMLElement
    )
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Acceptance criteria' }).closest('section')?.className
      ).toContain('is-redrawn')
    )
    // The redrawn-field dot on the step list is gone under the redesign: the
    // rail only carries readiness()'s own state/word for each step, nothing
    // about what moved on a previous turn. Only the field named in `changed`
    // is marked — "assumptions" was not, so it stays unmarked.
    expect(
      screen.getByRole('heading', { name: 'Assumptions' }).closest('section')?.className
    ).not.toContain('is-redrawn')
  })

  it('marks nothing when nothing moved', async () => {
    withChanged([])
    await openStep('Plan')
    await waitFor(() => screen.getByText(/sessions are stored in Redis/))
    fireEvent.click(
      screen.getByText(/sessions are stored in Redis/).closest('button') as HTMLElement
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.turn', expect.anything())
    )
    expect(
      within(stepList())
        .getAllByRole('button')
        .some((step) => step.className.includes('is-redrawn'))
    ).toBe(false)
  })
})

// A blocking finding is decided in the "Needs you" band, alongside the open
// questions — not one at a time on the Red team step, and not sent until the
// band's own Send button collects every decision into one turn.
describe('deciding a blocking finding, in the band', () => {
  function withFinding() {
    const current = {
      ...order(),
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high' as const,
          category: 'wrong-outcome' as const,
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
      if (channel === 'foundry:order.converge') {
        return { order: current, compile: compileOrder(current) }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  it('offers a way to decide it, on the Red team step', async () => {
    withFinding()
    await openStep('Red team')
    await waitFor(() => screen.getByText('the outcome restates the problem'))
    expect(screen.getByRole('button', { name: 'Ask the architect' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Fix it…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Accept it' })).toBeTruthy()
  })

  // Reported: "fixed provides no way to fix anything." It marked the finding
  // resolved with nothing changed. Fixing is now saying how, to the architect,
  // and only once Send is pressed — not on typing it.
  it('sends the operator’s fix to the architect only once Send is pressed', async () => {
    withFinding()
    await openStep('Red team')
    await waitFor(() => screen.getByText('the outcome restates the problem'))
    fireEvent.click(screen.getByRole('button', { name: 'Fix it…' }))
    const how = screen.getByLabelText(/How should "the outcome restates the problem" be fixed/)
    fireEvent.change(how, { target: { value: 'state what will be observably different' } })
    expect(invoke).not.toHaveBeenCalledWith('foundry:order.converge', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: /Send \d decision/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', {
        id: 'WO-1',
        settle: {
          answers: [],
          accepts: [],
          fixes: [{ findingId: 'RT-1', how: 'state what will be observably different' }],
          asks: [],
        },
      })
    )
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:order.converge')).toHaveLength(1)
  })

  it('opens the fix box under the finding it is for', async () => {
    withFinding()
    await openStep('Red team')
    await waitFor(() => screen.getByText('the outcome restates the problem'))
    fireEvent.click(screen.getByRole('button', { name: 'Fix it…' }))
    const finding = screen.getByText(/the outcome restates the problem/).closest('.fdry-fnd')
    expect(finding?.querySelector('textarea')).toBeTruthy()
  })

  // Reported: "I should be able to ask the agent to close the red team
  // findings too." Fixed and Accept were the only moves, and both are the
  // operator doing the work.
  it('asks the architect to clear it, once Send is pressed', async () => {
    withFinding()
    await openStep('Red team')
    await waitFor(() => screen.getByText('the outcome restates the problem'))
    fireEvent.click(screen.getByRole('button', { name: 'Ask the architect' }))
    expect(invoke).not.toHaveBeenCalledWith('foundry:order.converge', expect.anything())

    fireEvent.click(screen.getByRole('button', { name: /Send \d decision/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', {
        id: 'WO-1',
        settle: {
          answers: [],
          accepts: [],
          fixes: [],
          asks: ['RT-1'],
        },
      })
    )
  })

  // Nothing here is hidden while a turn runs, and the settle just sent
  // cleared its own selection, so there is nothing left to send again.
  it('keeps the step open while the architect works, with nothing left queued to send', async () => {
    mountAsking({
      ...order(),
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high' as const,
          category: 'wrong-outcome' as const,
          text: 'the outcome restates the problem',
          status: 'open' as const,
          reason: '',
        },
      ],
    })
    await openStep('Red team')
    await waitFor(() => screen.getByText('the outcome restates the problem'))
    fireEvent.click(screen.getByRole('button', { name: 'Ask the architect' }))
    fireEvent.click(screen.getByRole('button', { name: /Send \d decision/ }))
    await waitFor(() => expect(converges()).toBe(1))

    expect(screen.getByRole('button', { name: 'Ask the architect' })).toBeTruthy()
    // The choice just sent was cleared, and nothing new is decided — Send is
    // unavailable for that ordinary reason, not because anything is queued:
    // this fixture's turn only starts once the send itself calls converge.
    const send = screen.getByRole('button', { name: 'Send decisions' })
    expect(isUnavailable(send)).toBe(true)
    expect(reasonFor(send)).toBe('Choose an answer or a decision above first.')
  })

  it('asks for the reason before accepting one', async () => {
    withFinding()
    await openStep('Red team')
    await waitFor(() => screen.getByText('the outcome restates the problem'))
    fireEvent.click(screen.getByRole('button', { name: 'Accept it' }))
    const box = await screen.findByLabelText(/Why "the outcome restates the problem" is accepted/)

    // Nothing is sent until there is one — a shrug is not a decision.
    const send = () => screen.getByRole('button', { name: /^Send( \d)? decisions?$/ })
    expect(isUnavailable(send())).toBe(true)

    fireEvent.change(box, { target: { value: 'the risk is priced in' } })
    expect(isUnavailable(send())).toBe(false)
    fireEvent.click(send())
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', {
        id: 'WO-1',
        settle: {
          answers: [],
          accepts: [{ findingId: 'RT-1', reason: 'the risk is priced in' }],
          fixes: [],
          asks: [],
        },
      })
    )
  })
})

// The band collects every open question and every blocking finding, and one
// Send turns everything decided into a single call — the fix for the run that
// cost seven serial turns on seven findings, one clicked at a time.
// Deleted: "settling everything the operator decided in one submit" used to
// combine open-question answers and red-team accept/fix decisions into a
// single converge call from one shared band. The redesign put open questions
// on the Plan step and red-team findings on the Red team step, each with its
// own Send — `sendDecisionsOnThisStep` only ever fills one half of `Settle`
// and leaves the other empty, so the two can no longer be sent together.
// Replaced below with one "collects everything on this step" test per step.
describe('answering the open questions on the Plan step, one submit', () => {
  function withQuestions() {
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
      openQuestions: [
        {
          id: 'Q-1',
          text: 'which token?',
          why: '',
          options: ['a', 'b'],
          recommended: 0,
          answer: null,
          rank: 2,
        },
        {
          id: 'Q-2',
          text: 'which clock?',
          why: '',
          options: ['server', 'client'],
          recommended: 0,
          answer: null,
          rank: 1,
        },
      ],
    }
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: current, compile: compileOrder(current) }
      }
      if (channel === 'foundry:order.converge') {
        return { order: current, compile: compileOrder(current) }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  it('issues one converge call carrying every answer', async () => {
    withQuestions()
    await waitFor(() => screen.getByText('which token?'))

    fireEvent.click(screen.getByRole('button', { name: 'b' }))
    fireEvent.click(screen.getByRole('button', { name: 'client' }))
    expect(screen.getByText(/2 of 2 decided/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Send( \d)? decisions?$/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', {
        id: 'WO-1',
        settle: {
          answers: [
            { questionId: 'Q-1', option: 1 },
            { questionId: 'Q-2', option: 1 },
          ],
          accepts: [],
          fixes: [],
          asks: [],
        },
      })
    )
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:order.converge')).toHaveLength(1)
  })

  it('leaves Send unavailable until at least one question is answered', async () => {
    withQuestions()
    await waitFor(() => screen.getByText('which token?'))
    const send = () => screen.getByRole('button', { name: /^Send( \d)? decisions?$/ })
    expect(isUnavailable(send())).toBe(true)
    expect(reasonFor(send())).toBe('Choose an answer or a decision above first.')
    fireEvent.click(screen.getByRole('button', { name: 'b' }))
    expect(isUnavailable(send())).toBe(false)
  })
})

describe('deciding two red-team findings on the Red team step, one submit', () => {
  function withFindings() {
    const current = {
      ...order(),
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high' as const,
          category: 'wrong-outcome' as const,
          text: 'finding one',
          status: 'open' as const,
          reason: '',
        },
        {
          id: 'RT-2',
          severity: 'high' as const,
          category: 'regression' as const,
          text: 'finding two',
          status: 'open' as const,
          reason: '',
        },
      ],
    }
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: current, compile: compileOrder(current) }
      }
      if (channel === 'foundry:order.converge') {
        return { order: current, compile: compileOrder(current) }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  it('issues exactly one converge call carrying every decision', async () => {
    withFindings()
    await openStep('Red team')
    await waitFor(() => screen.getByText('finding one'))

    const findingOne = screen.getByText('finding one').closest('.fdry-fnd') as HTMLElement
    fireEvent.click(within(findingOne).getByRole('button', { name: 'Fix it…' }))
    fireEvent.change(within(findingOne).getByLabelText(/How should "finding one" be fixed/), {
      target: { value: 'do it this way' },
    })

    const findingTwo = screen.getByText('finding two').closest('.fdry-fnd') as HTMLElement
    fireEvent.click(within(findingTwo).getByRole('button', { name: 'Accept it' }))
    fireEvent.change(within(findingTwo).getByLabelText(/Why "finding two" is accepted/), {
      target: { value: 'priced in' },
    })

    expect(screen.getByText(/2 of 2 decided/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^Send( \d)? decisions?$/ }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', {
        id: 'WO-1',
        settle: {
          answers: [],
          accepts: [{ findingId: 'RT-2', reason: 'priced in' }],
          fixes: [{ findingId: 'RT-1', how: 'do it this way' }],
          asks: [],
        },
      })
    )
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:order.converge')).toHaveLength(1)
  })

  it('leaves Send unavailable until at least one finding is decided', async () => {
    withFindings()
    await openStep('Red team')
    await waitFor(() => screen.getByText('finding one'))
    const send = () => screen.getByRole('button', { name: /^Send( \d)? decisions?$/ })
    expect(isUnavailable(send())).toBe(true)

    const findingOne = screen.getByText('finding one').closest('.fdry-fnd') as HTMLElement
    fireEvent.click(within(findingOne).getByRole('button', { name: 'Ask the architect' }))
    expect(isUnavailable(send())).toBe(false)
  })
})

// A settle made while the architect is already working on a different turn
// cannot race it: the proposal is merged over the order as it stood when that
// turn started, so a settle sent meanwhile is one it never saw. It waits, and
// goes the moment the running turn ends.
describe('a settle made while the architect is drafting', () => {
  it('is queued, shown as queued, and sent once the turn ends', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const initial = {
      ...order(),
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high' as const,
          category: 'wrong-outcome' as const,
          text: 'finding one',
          status: 'open' as const,
          reason: '',
        },
      ],
    }
    const running = {
      kind: 'running',
      at: '2026-09-17T23:05:42Z',
      sessionId: 'sess-1',
      asked: '',
      actor: 'architect',
      trigger: 'you',
      round: null,
      autoTurn: null,
    }
    const ended = { kind: 'redrafted', at: '2026-09-17T23:06:00Z', note: 'redrafted the plan' }
    let polls = 0
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        polls += 1
        // The turn the operator asked about ends after the first poll — this
        // test is about the settle sent afterwards, not about how many polls
        // a turn takes.
        return {
          order: initial,
          compile: compileOrder(initial),
          intake: polls > 1 ? ended : running,
        }
      }
      if (channel === 'foundry:order.converge') {
        return { order: initial, compile: compileOrder(initial) }
      }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)

    await openStep('Red team')
    await vi.waitFor(() => screen.getByText('finding one'))
    fireEvent.click(screen.getByRole('button', { name: 'Ask the architect' }))
    fireEvent.click(screen.getByRole('button', { name: /^Send( \d)? decisions?$/ }))

    // ReasonButton swaps in a new DOM node once it renders as unavailable
    // (it wraps the button in a `<span>` to hold the tooltip), so the
    // control has to be re-queried after the click rather than reused.
    const send = screen.getByRole('button', { name: /^Send( \d)? decisions?$/ })
    expect(invoke).not.toHaveBeenCalledWith('foundry:order.converge', expect.anything())
    expect(isUnavailable(send)).toBe(true)
    expect(reasonFor(send)).toContain('queued')

    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', {
        id: 'WO-1',
        settle: { answers: [], accepts: [], fixes: [], asks: ['RT-1'] },
      })
    )
    vi.useRealTimers()
  })
})

describe('reading a finding', () => {
  function withText(redTeam: WorkOrder['redTeam']) {
    const current = { ...order(), redTeam }
    invoke = vi.fn(async (channel: string) =>
      channel === 'foundry:order.compile' ? { order: current, compile: compileOrder(current) } : {}
    )
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  const open = (text: string) => ({
    id: 'RT-red-team-1',
    severity: 'high' as const,
    text,
    status: 'open' as const,
    reason: '',
  })

  // Deleted: "leads with its first sentence and folds the rest under it" and
  // "renders the detail as markdown, so a list is a list". Both covered a
  // per-finding <details> fold that no longer exists — readiness.ts's
  // `findingText` now does the truncation itself, keeping only the first
  // paragraph and dropping everything after the first blank line (including
  // any list in it), so there is nothing left for Forge.tsx to fold.

  it('shows a one-sentence finding with nothing folded under it', async () => {
    withText([open('The order excludes nothing.')])
    await openStep('Red team')
    expect(screen.getByText('The order excludes nothing.')).toBeTruthy()
    expect(document.querySelector('.fdry-fnd details')).toBeNull()
  })

  it('drops a finding’s detail paragraph, keeping only its first sentence', async () => {
    withText([
      open(
        'The handler filters after a fixed `limit: 50` fetch.\n\nLinear has no state filter, so an operator with 50+ closed tickets gets an empty list.'
      ),
    ])
    await openStep('Red team')
    expect(screen.getByText(/The handler filters after a fixed/)).toBeTruthy()
    expect(screen.queryByText(/Linear has no state filter/)).toBeNull()
  })

  // "Ask the architect seems to not do anything": the redraft landed, and
  // nothing on screen said what it had done about the finding.
  it('lists what cleared a finding, and how', async () => {
    withText([
      {
        ...open('The handler filters after a fixed `limit: 50` fetch.'),
        status: 'resolved',
        reason: 'architect: AC-1 now pages past 50 tickets',
      },
    ])
    await openStep('Red team')
    const resolved = document.querySelector('.fdry-group--resolved') as HTMLElement
    expect(resolved).toBeTruthy()
    expect(within(resolved).getByText(/The handler filters after a fixed/)).toBeTruthy()
    expect(within(resolved).getByText('architect: AC-1 now pages past 50 tickets')).toBeTruthy()
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
    const running = {
      kind: 'running',
      at: '2026-09-09T19:30:00Z',
      sessionId: 'sess-arch',
      asked: '',
      actor: 'architect',
      trigger: 'you',
      round: null,
      autoTurn: null,
    }
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

  // Deleted: "stops once the architect has written its line" and "stops
  // when the turn was refused, though nothing was saved" asserted that the
  // 3s poll itself stopped once a turn ended. Under the redesign the poll's
  // only gate is `order.status === 'draft'` (Forge.tsx's REDRAFT_POLL_MS
  // effect) — it keeps refreshing a draft order for as long as it stays a
  // draft, independent of whether a turn is running, so there is no longer
  // a "poll stopped" moment to assert. What each test actually cared about —
  // the "architect is working" strip clearing once the turn ends — still
  // holds, and is kept below without the call-count assertion.
  it('clears "the architect is working" once the redraft lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    landsAfter(1, REDRAFTED)
    await vi.waitFor(() => screen.getByRole('button', { name: /Draft the plan/ }))
    fireEvent.click(screen.getByRole('button', { name: /Draft the plan/ }))
    await vi.advanceTimersByTimeAsync(9_000)
    await vi.waitFor(() => expect(screen.queryByText(/The architect is working/)).toBeNull())
    vi.useRealTimers()
  })

  // The reported bug, whole. A refusal saves nothing, so the document is
  // byte-for-byte what it was — and the stop condition used to be the document
  // growing. The button read "The architect is working…" over a turn that had
  // ended forty minutes earlier, and the poll never stopped.
  it('clears "the architect is working" when the turn was refused, though nothing was saved', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    landsAfter(1, REFUSED)
    await vi.waitFor(() => screen.getByRole('button', { name: /Draft the plan/ }))
    fireEvent.click(screen.getByRole('button', { name: /Draft the plan/ }))
    await vi.advanceTimersByTimeAsync(9_000)
    await vi.waitFor(() => expect(screen.queryByText(/The architect is working/)).toBeNull())
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
          intake: {
            kind: 'running',
            at: '2026-09-09T19:40:00Z',
            sessionId: 'sess-arch',
            asked: '',
            actor: 'architect',
            trigger: 'you',
            round: null,
            autoTurn: null,
          },
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
    await waitFor(() => expect(screen.getByText(/plan was refused/i)).toBeTruthy())
    expect(screen.getByText(/Invalid enum value/)).toBeTruthy()
    expect(screen.getByText(/Nothing on this order changed/)).toBeTruthy()
  })

  // A screen that names a problem and offers no reachable control is a wall.
  // The reason goes back with the ask because the architect cannot read its
  // own refusal: its turn ended before the validation ran.
  it('carries the reason back to the architect', async () => {
    refused()
    await waitFor(() => screen.getByText(/plan was refused/i))
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
    await waitFor(() => screen.getByText(/plan was refused/i))
    fireEvent.click(screen.getByRole('button', { name: /Start the turn over/ }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.converge', { id: 'WO-1' })
    )
  })
})

describe('what this order writes back (FR-062)', () => {
  it('offers each write-back, checked from the order', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await openStep('Tracker')
    expect(screen.getByLabelText(/The agreed order, as a comment/)).toBeTruthy()
    expect(screen.getByLabelText(/Move its workflow state/)).toBeTruthy()
    expect(screen.getByLabelText(/The pull request links/)).toBeTruthy()
  })

  it('turns one on for this order alone', async () => {
    mount({ capability: { transitions: 'supported', states: STATES, unreachable: [] } })
    await openStep('Tracker')
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
    await waitFor(() => screen.getByRole('heading', { name: 'What is being asked' }))
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
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    // Twice on purpose: once as the refusal, once on the override that answers
    // it. The message is what matters here.
    await waitFor(() => expect(screen.getAllByText(/waiting for review/).length).toBeGreaterThan(0))
    expect(screen.getByText(/the run did not start/)).toBeTruthy()
  })

  it('offers the override, naming what is waiting', async () => {
    mountForStart({ start: refuse })
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Start anyway — 3 waiting/ })).toBeTruthy()
    )
  })

  it('starts it when the operator takes the override', async () => {
    mountForStart({ start: refuse })
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
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
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
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

/**
 * The order refuses on `current`, and a converge starts a turn that is still
 * running on every read after it — carrying what it was asked, as the ledger
 * does.
 */
function mountAsking(current: WorkOrder) {
  let running: Record<string, unknown> | null = null
  invoke = vi.fn(async (channel: string, payload: { message?: string }) => {
    const intake = running ?? { kind: 'none' }
    if (channel === 'foundry:order.compile') {
      return { order: current, compile: compileOrder(current), intake }
    }
    if (channel === 'foundry:order.converge') {
      running = {
        kind: 'running',
        at: '2026-09-17T23:05:42Z',
        sessionId: 'sess-1',
        asked: payload.message ?? '',
        actor: 'architect',
        trigger: 'you',
        round: null,
        autoTurn: null,
      }
      return {
        order: current,
        compile: compileOrder(current),
        converging: 'sess-1',
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

function converges(): number {
  return invoke.mock.calls.filter((c) => c[0] === 'foundry:order.converge').length
}

// Reported: "I clicked ask for the gap to be closed but there's no indication
// it's working." The button went faintly disabled and kept its label; the only
// word that anything had started was in the header, out of view.
describe('an ask the architect is working on', () => {
  it('says so on the check it was asked about, in place of the button', async () => {
    mountAsking(orderBlockedOnPictures() as WorkOrder)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for proof' }))

    const status = await screen.findByRole('status', { name: /Asked/ })
    expect(status.textContent).toMatch(/the architect is working on it/)
    expect(screen.queryByRole('button', { name: 'Ask for proof' })).toBeNull()
    expect(converges()).toBe(1)
  })

  it('offers no other ask while one is running — a second turn would race the first', async () => {
    const blocked = orderBlockedOnPictures()
    // Fails coverage as well: a unit that satisfies nothing.
    mountAsking({
      ...blocked,
      plan: {
        ...blocked.plan,
        units: [...blocked.plan.units, { ...blocked.plan.units[0], id: 'U-2', satisfies: [] }],
      },
    } as WorkOrder)
    await openStep('Hand off')
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for proof' }))
    await screen.findByRole('status', { name: /Asked/ })
    expect(screen.queryByRole('button', { name: 'Ask for the gap to be closed' })).toBeNull()
  })

  it('says so again after leaving the step and coming back, from the record', async () => {
    mountAsking(orderBlockedOnPictures() as WorkOrder)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for proof' }))
    await screen.findByRole('status', { name: /Asked/ })
    await openStep('Intent')
    await openStep('Plan')
    expect(await screen.findByRole('status', { name: /Asked/ })).toBeTruthy()
  })

  // Reported: accepting items while the architect worked ended in refusals.
  // Its proposal is merged over the order as it stood when the turn started,
  // so an edit made meanwhile is one the architect never saw — everything
  // outside the band still holds. The band's own choices are different: they
  // are a local decision that goes nowhere until Send, so keeping them live
  // during a different turn loses nothing.
  it('holds every other move on the order until the turn ends, but not the band', async () => {
    mountAsking({
      ...orderBlockedOnPictures(),
      openQuestions: [
        {
          id: 'Q-1',
          text: 'which token?',
          why: '',
          options: ['a', 'b'],
          recommended: 0,
          answer: null,
          rank: 1,
          confidence: null,
        },
      ],
      assumptions: [{ id: 'A-1', text: 'tokens are JWTs', struck: false, affects: [] }],
    } as WorkOrder)
    fireEvent.click(await screen.findByRole('button', { name: 'Ask for proof' }))
    await screen.findByRole('status', { name: /Asked/ })

    expect(screen.getByRole('button', { name: 'a (recommended)' })).toHaveProperty(
      'disabled',
      false
    )
    expect(screen.getByRole('button', { name: 'b' })).toHaveProperty('disabled', false)
    await openStep('Plan')
    expect(isUnavailable(screen.getByRole('button', { name: /tokens are JWTs/ }))).toBe(true)
  })
})

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

  it('offers the written escape, and takes the operator to it from hand-off', async () => {
    mountBlocked()
    await openStep('Hand off')
    fireEvent.click(screen.getByRole('button', { name: /Or mark one unprovable/ }))
    // The heading it lands on is the one the acceptance list sits under, on the
    // step that list is on.
    await waitFor(() => expect(document.getElementById('fdry-acceptance')).not.toBeNull())
    expect(document.activeElement?.id).toBe('fdry-acceptance')
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
    const accept = screen.getByRole('button', { name: 'Accept it' })
    expect(isUnavailable(accept)).toBe(true)
    expect(reasonFor(accept)).toBe('Say why it stands. The reason travels with the order.')
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
    // Nothing blocks once it is accepted, so the order opens on hand-off.
    await openStep('Plan')
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
    await openStep('Hand off')
    fireEvent.click(screen.getByRole('button', { name: 'Answer them' }))
    expect(invoke).not.toHaveBeenCalledWith('foundry:order.converge', expect.anything())
  })

  it('offers no remedy on a check that passes', async () => {
    mountBlocked()
    await waitFor(() => screen.getByRole('heading', { name: 'The plan and how it is proven' }))
    // Risk is graded against this plan, so its row carries no button.
    expect(screen.queryByRole('button', { name: 'Ask for a regrade' })).toBeNull()
  })

  it('offers no remedy at all once the order has been handed off', async () => {
    mountBlocked({ status: 'running' as const })
    await waitFor(() => screen.getByText('Refuse an expired refresh token'))
    expect(screen.queryByRole('button', { name: 'Ask for proof' })).toBeNull()
    await openStep('Plan')
    expect(screen.queryByRole('button', { name: 'Nothing here can prove this' })).toBeNull()
  })
})

// Budgets came from settings and could be changed nowhere on an order, and
// the architect could replace them. They are the operator's, on the Plan step.
describe('an order’s budgets', () => {
  const SET = { agents: 3, wallClockMinutes: 45, tokens: null }

  it('shows them on the Plan step and saves what the operator sets', async () => {
    mountBlocked({ budgets: { agents: 2, wallClockMinutes: null, tokens: null } })
    await openStep('Plan')
    const section = await waitFor(() => screen.getByRole('region', { name: 'Budgets' }))
    expect(
      (within(section).getByRole('checkbox', { name: 'No limit on minutes' }) as HTMLInputElement)
        .checked
    ).toBe(true)

    fireEvent.change(within(section).getByRole('spinbutton', { name: 'Agents at once' }), {
      target: { value: '4' },
    })
    fireEvent.click(within(section).getByRole('button', { name: 'Save budgets' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.budgets', {
        id: 'WO-1',
        budgets: { agents: 4, wallClockMinutes: null },
      })
    )
  })

  // ADR 056: agents and minutes are budgets; a count of files is not.
  it('offers no files budget, and no check that a plan fits one', async () => {
    mountBlocked({ budgets: SET })
    await openStep('Plan')
    const section = await waitFor(() => screen.getByRole('region', { name: 'Budgets' }))
    expect(within(section).queryByRole('spinbutton', { name: 'Files touched' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change the budget' })).toBeNull()
  })

  it('shows them without controls once the order is no longer a draft', async () => {
    mountBlocked({ status: 'running' as const, budgets: SET })
    await openStep('Plan')
    const section = await waitFor(() => screen.getByRole('region', { name: 'Budgets' }))
    expect(within(section).getByText('3 agents · 45 minutes')).toBeTruthy()
    expect(within(section).queryByRole('button', { name: 'Save budgets' })).toBeNull()
  })
})

// Walked, one step at a time, rather than read off a rail of tiles beside the
// document: an operator reported the rail's cards as too condensed to read.
describe('walking the Forge', () => {
  it('opens on the step that is blocking, not on the first one', async () => {
    mountBlocked()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'The plan and how it is proven' })).toBeTruthy()
    )
    expect(
      within(stepList()).getByRole('button', { name: /^Plan/ }).getAttribute('aria-current')
    ).toBe('step')
  })

  it('marks the blocking step on the step list, and leaves the others alone', async () => {
    mountBlocked()
    await waitFor(() => screen.getByRole('heading', { name: 'The plan and how it is proven' }))
    const planStep = within(stepList()).getByRole('button', { name: /^Plan/ })
    expect(planStep.className).toContain('fdry-rail-step--bad')
    const intentStep = within(stepList()).getByRole('button', { name: /^Intent/ })
    expect(intentStep.className).toContain('fdry-rail-step--done')
  })

  it('goes forward to the next step and back again', async () => {
    mount({})
    await waitFor(() => screen.getByRole('heading', { name: 'What is being asked' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next: Plan' }))
    expect(screen.getByRole('heading', { name: 'The plan and how it is proven' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'What is being asked' })).toBeTruthy()
  })

  it('offers no way back from the first step, and hand-off in place of next on the last', async () => {
    mountForStart()
    await waitFor(() => screen.getByRole('heading', { name: 'Ready to hand off?' }))
    expect(screen.queryByRole('button', { name: /^Next/ })).toBeNull()
    await openStep('Intent')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(queryHandOffButton()).toBeNull()
  })

  it('moves focus to the step it opened, for a keyboard user', async () => {
    mount({})
    await waitFor(() => screen.getByRole('heading', { name: 'What is being asked' }))
    await openStep('Red team')
    expect(document.activeElement?.textContent).toBe('Red team findings')
  })
})

// What the architect and the red team write is markdown, and is shown as
// markdown — not as asterisks and backticks.
describe('agent text is rendered as markdown', () => {
  const md = {
    openQuestions: [
      {
        id: 'Q-1',
        text: 'Hide **done** tickets?',
        why: 'The picker lists `completed` ones.\n\n- one\n- two',
        options: ['Hide *them*', 'Grey them'],
        recommended: 0,
        answer: null,
        rank: 1,
        confidence: 0.5,
      },
    ],
    acceptance: [
      {
        id: 'AC-1',
        statement: 'Only **open** tickets are listed',
        priority: 'P1' as const,
        verify: { kind: 'test' as const, command: 'npm test', assert: 'exit_code == 0' },
        unverifiable: null,
      },
    ],
    assumptions: [
      { id: 'A-1', text: 'The filter lives in `Orders.tsx`', struck: false, affects: [] },
    ],
    redTeam: [
      {
        id: 'RT-x',
        severity: 'medium' as const,
        text: 'The plan never touches **the picker**',
        status: 'open' as const,
        reason: '',
      },
    ],
  }

  it('renders a question, its reason and its options', async () => {
    mount({}, md)
    await waitFor(() => screen.getByText('done'))
    expect(screen.getByText('done').tagName).toBe('STRONG')
    expect(screen.getByText('completed').tagName).toBe('CODE')
    expect(screen.getByText('one').tagName).toBe('LI')
    expect(screen.getByText('them').tagName).toBe('EM')
  })

  it('renders criteria and assumptions on the Plan step', async () => {
    mount({}, md)
    await openStep('Plan')
    await waitFor(() => screen.getByText('open'))
    expect(screen.getByText('open').tagName).toBe('STRONG')
    expect(screen.getByText('Orders.tsx').tagName).toBe('CODE')
  })

  it('renders a red-team finding on the Red team step', async () => {
    mount({}, md)
    await openStep('Red team')
    await waitFor(() => screen.getByText('the picker'))
    expect(screen.getByText('the picker').tagName).toBe('STRONG')
  })
})

// New coverage for the ADR 074 redesign: readiness() driving the strip, the
// Hand off row, shape choice mid-turn, automatic hand-off, the finding
// groups, and the hold/release controls — plus a sweep that no unavailable
// control anywhere is missing its reason.

describe('a red-team round running', () => {
  it('shows the round on the strip, and locks Hand off with a description naming it', async () => {
    mountForStart({
      intake: {
        kind: 'running',
        at: '2026-09-06T10:00:00.000Z',
        sessionId: 'S-1',
        asked: '',
        actor: 'red team',
        trigger: 'automatic',
        round: 2,
        autoTurn: null,
      },
    })
    await waitFor(() =>
      expect(screen.getByText('The red team is reviewing the plan · round 2 of 3')).toBeTruthy()
    )
    await openStep('Hand off')
    const handOff = screen.getByRole('button', { name: 'Hand off' })
    expect(isUnavailable(handOff)).toBe(true)
    expect(reasonFor(handOff)).toMatch(/^The red team is reviewing the plan \(round 2 of 3/)
  })
})

describe('choosing a shape while a turn is running', () => {
  function mountShapeDuringTurn() {
    const running = {
      kind: 'running',
      at: '2026-09-06T10:00:00.000Z',
      sessionId: 'S-1',
      asked: '',
      actor: 'architect',
      trigger: 'you',
      round: null,
      autoTurn: null,
    }
    const current = order()
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return { order: current, compile: compileOrder(current), intake: running }
      }
      if (channel === 'foundry:order.states') return {}
      if (channel === 'foundry:run.recipes') {
        return {
          recipes: [
            { name: 'direct', available: true, unmet: [], rung: 'built-in' },
            { name: 'standard', available: true, unmet: [], rung: 'built-in' },
          ],
          proposed: 'standard',
          proposedWhy: '2 units of work',
          chosen: 'direct',
          chosenAt: '2026-09-06T10:05:00.000Z',
        }
      }
      if (channel === 'foundry:order.recipe') return { ok: true }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  it('invokes order.recipe with the shape clicked, even mid-turn', async () => {
    mountShapeDuringTurn()
    await openStep('Shape')
    fireEvent.click(await screen.findByText('Standard'))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.recipe', {
        id: 'WO-1',
        recipe: 'standard',
      })
    )
  })

  it('"Use the proposal" invokes order.recipe with recipe: null', async () => {
    mountShapeDuringTurn()
    await openStep('Shape')
    fireEvent.click(await screen.findByRole('button', { name: 'Use the proposal' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.recipe', { id: 'WO-1', recipe: null })
    )
  })
})

describe('an order agreed and handed off automatically', () => {
  it('says so, with the time it happened', async () => {
    const current = { ...order(), status: 'running' as const }
    invoke = vi.fn(async (channel: string) =>
      channel === 'foundry:order.compile'
        ? {
            order: current,
            compile: compileOrder(current),
            agreed: { by: 'automatic', at: '2026-09-06T10:05:00.000Z' },
          }
        : {}
    )
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
    await waitFor(() => expect(screen.getByText(/Handed off automatically at/)).toBeTruthy())
  })
})

describe('findings grouped by who acts on them', () => {
  it('shows a note under "Notes, nothing to do" and a blocking finding under "Needs your decision"', async () => {
    const current = {
      ...order(),
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high' as const,
          category: 'wrong-outcome' as const,
          text: 'blocking one',
          status: 'open' as const,
          reason: '',
          round: 2,
        },
        {
          id: 'RT-2',
          severity: 'low' as const,
          category: 'pre-existing' as const,
          text: 'note one',
          status: 'open' as const,
          reason: '',
        },
      ],
    }
    invoke = vi.fn(async (channel: string) =>
      channel === 'foundry:order.compile'
        ? {
            order: current,
            compile: compileOrder(current),
            intake: { kind: 'redrafted', at: '2026-09-06T10:10:00.000Z', note: 'redrafted' },
            loop: {
              rounds: [
                {
                  round: 1,
                  startedAt: '2026-09-06T09:50:00.000Z',
                  finishedAt: '2026-09-06T09:55:00.000Z',
                },
                {
                  round: 2,
                  startedAt: '2026-09-06T09:56:00.000Z',
                  finishedAt: '2026-09-06T10:00:00.000Z',
                },
              ],
              heldAt: null,
              exhausted: true,
            },
          }
        : {}
    )
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
    await openStep('Red team')
    await waitFor(() => screen.getByText('blocking one'))
    expect(screen.getByText('Notes, nothing to do')).toBeTruthy()
    expect(screen.getByText('note one')).toBeTruthy()
    expect(screen.getByText('Needs your decision')).toBeTruthy()
    const finding = screen.getByText('blocking one').closest('.fdry-fnd') as HTMLElement
    expect(within(finding).getByRole('button', { name: 'Ask the architect' })).toBeTruthy()
    expect(within(finding).getByRole('button', { name: 'Fix it…' })).toBeTruthy()
    expect(within(finding).getByRole('button', { name: 'Accept it' })).toBeTruthy()
  })
})

describe('holding and releasing the red-team loop from the strip', () => {
  function mountRedTeamRunning(heldAt: string | null) {
    const current = order()
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:order.compile') {
        return {
          order: current,
          compile: compileOrder(current),
          intake: {
            kind: 'running',
            at: '2026-09-06T10:00:00.000Z',
            sessionId: 'S-1',
            asked: '',
            actor: 'red team',
            trigger: 'automatic',
            round: 2,
            autoTurn: null,
          },
          loop: {
            rounds: [{ round: 2, startedAt: '2026-09-06T09:56:00.000Z', finishedAt: null }],
            heldAt,
            exhausted: false,
          },
        }
      }
      if (channel === 'foundry:order.hold') return { ok: true }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
  }

  it('"Hold for me" invokes order.hold with held: true', async () => {
    mountRedTeamRunning(null)
    fireEvent.click(await screen.findByRole('button', { name: 'Hold for me' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.hold', { id: 'WO-1', held: true })
    )
  })

  it('"Let it continue" invokes order.hold with held: false', async () => {
    mountRedTeamRunning('2026-09-06T10:01:00.000Z')
    fireEvent.click(await screen.findByRole('button', { name: 'Let it continue' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:order.hold', { id: 'WO-1', held: false })
    )
  })
})

// Every ReasonButton that renders aria-disabled must resolve its
// aria-describedby to non-empty text (ReasonButton.tsx) — swept across the
// states that put controls out of reach: a running turn, a refusal, findings
// needing a decision, a step whose shape has an unmet requirement, and a
// handed-off order.
describe('every unavailable control names why, everywhere (ADR 074)', () => {
  function auditUnavailableControls(): void {
    const nodes = Array.from(document.querySelectorAll('[aria-disabled="true"]'))
    expect(nodes.length).toBeGreaterThan(0)
    for (const node of nodes) {
      const id = node.getAttribute('aria-describedby')
      expect(id).not.toBeNull()
      const tip = document.getElementById(id as string)
      expect(tip?.textContent?.trim()).not.toBe('')
    }
  }

  it('holds on a running turn', async () => {
    mountForStart({
      intake: {
        kind: 'running',
        at: '2026-09-06T10:00:00.000Z',
        sessionId: 'S-1',
        asked: '',
        actor: 'architect',
        trigger: 'you',
        round: null,
        autoTurn: null,
      },
    })
    await waitFor(() =>
      expect(screen.getAllByText(/architect is working/).length).toBeGreaterThan(0)
    )
    await openStep('Hand off')
    auditUnavailableControls()
  })

  it('holds on a refused turn', async () => {
    const shown = order()
    invoke = vi.fn(async (channel: string) =>
      channel === 'foundry:order.compile'
        ? {
            order: shown,
            compile: compileOrder(shown),
            intake: { kind: 'refused', at: '2026-09-06T10:00:00.000Z', reason: 'bad proposal' },
          }
        : {}
    )
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
    await waitFor(() => screen.getByText(/plan was refused/i))
    auditUnavailableControls()
  })

  it('holds when a finding needs a decision', async () => {
    const current = {
      ...order(),
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high' as const,
          category: 'wrong-outcome' as const,
          text: 'blocking one',
          status: 'open' as const,
          reason: '',
          round: 1,
        },
      ],
    }
    invoke = vi.fn(async (channel: string) =>
      channel === 'foundry:order.compile'
        ? {
            order: current,
            compile: compileOrder(current),
            intake: { kind: 'redrafted', at: '2026-09-06T10:00:00.000Z', note: 'redrafted' },
            loop: {
              rounds: [
                {
                  round: 1,
                  startedAt: '2026-09-06T09:00:00.000Z',
                  finishedAt: '2026-09-06T09:05:00.000Z',
                },
              ],
              heldAt: null,
              exhausted: true,
            },
          }
        : {}
    )
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<Forge orderId="WO-1" />)
    await openStep('Red team')
    await waitFor(() => screen.getByText('blocking one'))
    // Nothing is decided yet, so Send is unavailable — the case under audit.
    auditUnavailableControls()
  })

  it('holds on the shape step even when the order is otherwise ready', async () => {
    mountForStart()
    await openStep('Shape')
    await waitFor(() => screen.getByText('Speckit'))
    auditUnavailableControls()
  })

  it('holds on a handed-off order whose shape is fixed', async () => {
    mountForStart()
    await waitFor(() => handOffButton())
    fireEvent.click(handOffButton())
    await waitFor(() => expect(screen.getAllByText(/Handed off/).length).toBeGreaterThan(0))
    await openStep('Shape')
    auditUnavailableControls()
  })
})
