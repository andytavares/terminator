import { describe, it, expect, vi } from 'vitest'
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
      return { order: shown, compile: compileOrder(shown), ...extra }
    }
    return {}
  })
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke, on: createChangeBus().on } },
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
    await screen.findByText('that conversation no longer has a terminal')
  })
})

describe('redrafting a plan there is', () => {
  it('asks the architect for another turn, carrying nothing', async () => {
    mountForgeOver(compilableOrder(), {})
    fireEvent.click(await within(await header()).findByRole('button', { name: /Redraft/ }))
    await waitFor(() =>
      expect(payloadsSentOn(invoke, 'foundry:order.converge')).toEqual([{ id: 'WO-1' }])
    )
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

/** Hands the order off, with compile answering `committed` to the agreeing call. */
async function handOffWith(committed: unknown) {
  const shown = compilableOrder()
  const onStarted = mountForgeOver(shown, {
    answers: {
      'foundry:order.compile': (payload) =>
        payload.commit === true ? committed : { order: shown, compile: compileOrder(shown) },
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
    const onStarted = await handOffWith({ order: shown, compile: compileOrder(shown) })
    await waitFor(() => expect(screen.getByRole('button', { name: /^Hand off with/ })).toBeTruthy())
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
