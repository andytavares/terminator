import { PROVEN_ENVIRONMENT, provenBaseline } from '../helpers/environment.js'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { createChangeBus } from '../helpers/change-bus.js'
import { Forge } from '../../src/components/Forge.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { payloadsSentOn } from '../helpers/bridge-calls.js'
import { openForgeStep } from '../helpers/forge-steps.js'

// The Forge's moves outside a step's own controls: watching and redrafting, opening the run,
// answering a refused proposal from its row, a refused hand-off. Each is one channel.

// jsdom doesn't implement scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn()

type Answer = (payload: Record<string, unknown>) => unknown
let invoke = vi.fn()
const recordUsage = vi.fn()
const usageStub = { usage: { record: recordUsage } }

beforeEach(() => recordUsage.mockClear())

/** One criterion, proved by the test command. */
const CRITERION: WorkOrder['acceptance'][number] = {
  id: 'AC-1',
  statement: 'a',
  priority: 'P1',
  verify: { kind: 'test', command: 'npm test', assert: 'exit_code == 0' },
  unverifiable: null,
}

/** One builder unit in lane 1 that satisfies AC-1. */
const UNIT: WorkOrder['plan']['units'][number] = {
  id: 'U-1',
  title: 'a',
  role: 'builder',
  lane: 1,
  dependsOn: [],
  satisfies: ['AC-1'],
  touches: ['src/a.ts'],
  verify: [],
}

/** A typed order every compile check passes. */
function compilableOrder(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return {
    ...base,
    acceptance: [CRITERION],
    intent: { problem: 'p', outcome: 'o', nonGoals: [] },
    risk: { grade: 'P2', triggers: [], blastRadius: ['src/'], criticalPaths: [] },
    plan: { ...base.plan, units: [UNIT] },
    ...over,
  }
}

const RUNNING = {
  kind: 'running',
  at: '2026-09-09T19:40:00Z',
  sessionId: 'sess-arch',
  asked: '',
  actor: 'architect',
  trigger: 'you',
  round: null,
  autoTurn: null,
}

const REFUSED = { kind: 'refused', at: '2026-09-09T19:33:21Z', reason: 'it named a status' }

// Renders the Forge over `shown`, with `extra` folded into what compile answers;
// `answers` overrides any other channel, which otherwise says nothing.
function mountForgeOver(
  shown: WorkOrder,
  {
    extra = {},
    answers = {},
  }: { extra?: Record<string, unknown>; answers?: Record<string, Answer> }
) {
  const onStarted = vi.fn()
  invoke = vi.fn(async (channel: string, payload: Record<string, unknown> = {}) => {
    if (channel in answers) return answers[channel](payload)
    if (channel === 'foundry:order.compile') {
      return {
        order: shown,
        compile: compileOrder(shown),
        environment: PROVEN_ENVIRONMENT,
        ...extra,
      }
    }
    return {}
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke, on: createChangeBus().on }, ...usageStub },
    configurable: true,
    writable: true,
  })
  render(<Forge orderId="WO-1" onStarted={onStarted} />)
  return onStarted
}

/** A part of the Forge, once the order has loaded and drawn it. */
function part(selector: string): Promise<HTMLElement> {
  return waitFor(() => {
    const found = document.querySelector<HTMLElement>(selector)
    if (found === null) throw new Error(`nothing matches ${selector} yet`)
    return found
  })
}

const strip = () => part('.fdry-strip')
const header = () => part('.fdry-wiz-head')

describe('watching the architect at work', () => {
  it('goes to its terminal from the strip and from the header', async () => {
    mountForgeOver(compilableOrder(), {
      extra: { intake: RUNNING },
      answers: { 'foundry:run-terminal': () => ({ ok: true }) },
    })
    await waitFor(async () => expect((await strip()).textContent).toContain('your request'))
    fireEvent.click(within(await strip()).getByRole('button', { name: 'Watch the architect' }))
    fireEvent.click(within(await header()).getByRole('button', { name: 'Watch the architect' }))
    await waitFor(() => expect(payloadsSentOn(invoke, 'foundry:run-terminal')).toHaveLength(2))
    expect(payloadsSentOn(invoke, 'foundry:run-terminal')).toEqual([
      { sessionId: 'sess-arch' },
      { sessionId: 'sess-arch' },
    ])
  })

  it('says so when the architect has no terminal to go to', async () => {
    mountForgeOver(compilableOrder(), {
      extra: { intake: RUNNING },
      answers: { 'foundry:run-terminal': () => ({ ok: false }) },
    })
    fireEvent.click(
      await within(await header()).findByRole('button', { name: 'Watch the architect' })
    )
    await screen.findByText('that conversation no longer has an agent tab')
  })
})

describe('redrafting a plan there is', () => {
  it('asks the architect for another turn, carrying nothing', async () => {
    mountForgeOver(compilableOrder(), {})
    fireEvent.click(await within(await header()).findByRole('button', { name: /Redraft/ }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:order.converge')).toEqual([{ id: 'WO-1' }])
    )
    expect(recordUsage).toHaveBeenCalledExactlyOnceWith('forge-turn', {})
  })
})

describe('an order that has been handed off', () => {
  it('opens the run it started', async () => {
    const onStarted = mountForgeOver(
      compilableOrder({ status: 'running', agreedAt: '2026-09-09T19:00:00Z' }),
      {
        extra: { agreed: { at: '2026-09-09T19:00:00Z', by: 'you' } },
      }
    )
    fireEvent.click(await within(await strip()).findByRole('button', { name: 'Open the run' }))
    expect(onStarted).toHaveBeenCalledWith('WO-1')
  })
})

describe('a refused turn, from the row that failed', () => {
  it('says the rows are from before the refusal, and carries the reason back', async () => {
    mountForgeOver(compilableOrder(), { extra: { intake: REFUSED } })
    await openForgeStep('Hand off')
    await screen.findByText('These rows describe the order as it stood before the refused turn.')
    const rows = document.querySelector('.fdry-checks') as HTMLElement
    fireEvent.click(within(rows).getByRole('button', { name: 'Tell the architect what was wrong' }))
    const reason = expect.stringContaining('The reason: it named a status.')
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:order.converge')).toEqual([
        expect.objectContaining({ message: reason }),
      ])
    )
  })
})

const NOT_STARTED = {
  kind: 'not-started',
  at: '2026-09-09T19:33:21Z',
  actor: 'architect',
  reason: 'Mode dontAsk is not available in this session',
}

/** A draft with criteria and no units: nothing was ever drafted. */
function orderWithNoPlan(): WorkOrder {
  const order = compilableOrder()
  return { ...order, plan: { ...order.plan, units: [] } }
}

describe('an agent Claude could not start', () => {
  it('shows one message, with Try again and Copy the error and nothing about a refusal', async () => {
    mountForgeOver(orderWithNoPlan(), { extra: { intake: NOT_STARTED } })
    const shown = await strip()
    expect(within(shown).getByText('Claude could not start the architect.')).toBeTruthy()
    expect(shown.textContent).toContain('Claude said: "Mode dontAsk is not available')
    expect(within(shown).getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(within(shown).getByRole('button', { name: 'Copy the error' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Tell the architect what was wrong' })).toBeNull()
    expect(document.body.textContent).not.toMatch(/was refused|ended before it started/)
  })
})

describe('the moves out of an agent Claude could not start', () => {
  it('asks again with the same request from Try again, with no error line in the footer', async () => {
    const order = orderWithNoPlan()
    mountForgeOver(order, {
      extra: { intake: NOT_STARTED },
      answers: {
        'foundry:order.converge': () => ({
          order,
          compile: compileOrder(order),
          environment: PROVEN_ENVIRONMENT,
          intake: NOT_STARTED,
          error: 'Claude did not say why.',
        }),
      },
    })
    fireEvent.click(await within(await strip()).findByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:order.converge')).toEqual([{ id: 'WO-1' }])
    )
    expect(document.querySelector('.fdry-problem')).toBeNull()
  })

  it("copies Claude's reason from Copy the error", async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mountForgeOver(orderWithNoPlan(), { extra: { intake: NOT_STARTED } })
    fireEvent.click(await within(await strip()).findByRole('button', { name: 'Copy the error' }))
    expect(writeText).toHaveBeenCalledWith(NOT_STARTED.reason)
  })
})

describe('Try again after a red team that could not start', () => {
  it('picks the loop up from Try again when the red team could not start, with no new draft', async () => {
    const order = orderWithNoPlan()
    mountForgeOver(order, {
      extra: { intake: { ...NOT_STARTED, actor: 'red team' } },
      answers: {
        'foundry:order.resume': () => ({ order, compile: compileOrder(order) }),
      },
    })
    fireEvent.click(await within(await strip()).findByRole('button', { name: 'Try again' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:order.resume')).toEqual([{ id: 'WO-1' }])
    )
    expect(payloadsSentOn(invoke, 'foundry:order.converge')).toEqual([])
  })
})

describe('an order with no plan yet', () => {
  it('locks Next: Red team and reads coverage as waiting', async () => {
    mountForgeOver(orderWithNoPlan(), { extra: { intake: NOT_STARTED } })
    const next = await screen.findByRole('button', { name: /Next: Red team/ })
    expect(next.getAttribute('aria-disabled')).toBe('true')
    expect(document.body.textContent).toContain('Waits for a plan')
    await openForgeStep('Hand off')
    expect(screen.queryByRole('button', { name: 'Ask for the gap to be closed' })).toBeNull()
  })
})

/** Hands the order off, with compile answering `committed` to the agreeing call. */
async function handOffWith(committed: unknown) {
  const shown = compilableOrder()
  const onStarted = mountForgeOver(shown, {
    answers: {
      'foundry:order.compile': (payload) =>
        payload.commit === true
          ? committed
          : { order: shown, compile: compileOrder(shown), environment: PROVEN_ENVIRONMENT },
    },
  })
  await openForgeStep('Hand off')
  fireEvent.click(await screen.findByRole('button', { name: /^Hand off with/ }))
  const agreeing = { id: 'WO-1', commit: true }
  await waitFor(() =>
    expect(payloadsSentOn(invoke, 'foundry:order.compile')).toContainEqual(agreeing)
  )
  return onStarted
}

describe('a hand-off compile turns down', () => {
  it('says why and starts nothing when agreeing fails', async () => {
    const onStarted = await handOffWith({ error: 'the order changed under you' })
    await screen.findByText('the order changed under you')
    expect(payloadsSentOn(invoke, 'foundry:run.start')).toEqual([])
    expect(onStarted).not.toHaveBeenCalled()
  })

  it('starts nothing when the order comes back still a draft', async () => {
    const shown = compilableOrder()
    const onStarted = await handOffWith({
      order: shown,
      compile: compileOrder(shown),
      environment: PROVEN_ENVIRONMENT,
    })
    await screen.findByRole('button', { name: /^Hand off with/ })
    expect(payloadsSentOn(invoke, 'foundry:run.start')).toEqual([])
    expect(onStarted).not.toHaveBeenCalled()
  })
})

describe('a hand-off the Foundry backend refuses', () => {
  it('shows why, and starts nothing', async () => {
    const shown = compilableOrder()
    const onStarted = await handOffWith({
      order: shown,
      compile: compileOrder(shown),
      environment: PROVEN_ENVIRONMENT,
      refused: 'Lint failed on main with exit code 2: `npm run lint`.',
    })
    await screen.findByText('Lint failed on main with exit code 2: `npm run lint`.')
    expect(payloadsSentOn(invoke, 'foundry:run.start')).toEqual([])
    expect(onStarted).not.toHaveBeenCalled()
  })
})

describe('what this order writes back', () => {
  it('turns one off for this order alone', async () => {
    const shown = compilableOrder({
      source: { kind: 'tracker', tracker: 'linear', key: 'TAV-42', url: 'https://x' },
      writeBack: ['summary_comment', 'status'],
    })
    mountForgeOver(shown, {
      answers: {
        'foundry:order.states': () => ({
          capability: { transitions: 'supported', states: [], unreachable: [] },
        }),
      },
    })
    await openForgeStep('Tracker')
    fireEvent.click(await screen.findByLabelText(/Move its workflow state/))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:order.writeBack')).toEqual([
        { id: 'WO-1', writeBack: ['summary_comment'] },
      ])
    )
  })
})

const rows = () => document.querySelector('.fdry-checks') as HTMLElement

describe('the base branch row on the hand-off step', theBaseBranchRowTests)
describe('provenRowTests', provenRowTests)

function theBaseBranchRowTests() {
  it('offers to check again or skip this check, and sends the move chosen', async () => {
    mountForgeOver(compilableOrder(), {
      extra: { environment: { baseline: null, waivedAt: null } },
    })
    await openForgeStep('Hand off')
    await screen.findByText('Not checked for this order yet.')
    fireEvent.click(within(rows()).getByRole('button', { name: 'Check again' }))
    fireEvent.click(within(rows()).getByRole('button', { name: 'Skip this check' }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:forge.environment')).toEqual([
        { id: 'WO-1', move: 'check' },
        { id: 'WO-1', move: 'waive' },
      ])
    )
  })

  it('offers only "Skip this check" while the check runs', async () => {
    mountForgeOver(compilableOrder(), {
      extra: { environment: { baseline: provenBaseline({ state: 'checking' }), waivedAt: null } },
    })
    await openForgeStep('Hand off')
    await screen.findByText(/^Checking main:/)
    expect(within(rows()).queryByRole('button', { name: 'Check again' })).toBeNull()
    expect(within(rows()).getByRole('button', { name: 'Skip this check' })).toBeTruthy()
  })
}

function provenRowTests() {
  it('says why when a base branch move is turned down', async () => {
    mountForgeOver(compilableOrder(), {
      extra: { environment: { baseline: null, waivedAt: null } },
      answers: {
        'foundry:forge.environment': () => ({
          error: 'Only a draft order can check its base branch again.',
        }),
      },
    })
    await openForgeStep('Hand off')
    fireEvent.click(await within(rows()).findByRole('button', { name: 'Check again' }))
    expect(
      await screen.findByText('Only a draft order can check its base branch again.')
    ).toBeTruthy()
  })

  it('offers neither once the base branch is proven', async () => {
    mountForgeOver(compilableOrder(), {})
    await openForgeStep('Hand off')
    await screen.findByText(/^main at b289028 passed/)
    expect(within(rows()).queryByRole('button', { name: 'Skip this check' })).toBeNull()
  })
}
