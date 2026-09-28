import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
import React from 'react'
import { Forge } from '../../src/components/Forge.js'
import { Floor } from '../../src/components/Floor.js'
import { App } from '../../src/renderer/App.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'
import type { OpenQuestion, WorkOrder } from '../../src/order/schema.js'

// Where the things waiting on a person are on the screen.
//
// Foundry holds work for a person in three places, and every one of them used
// to be somewhere you had to already know about: the Forge's open questions
// third down a 260px rail under six checks and six recipe cards (the Forge is
// now walked as steps, with the questions above all of them), the Floor's
// held tool calls under an entire run graph, and the inbox behind a tab that
// said nothing until you clicked it. An operator reported the first of those
// as taking for ever to find, which it did.
//
// These assert position and presence in the rendered DOM rather than that a
// component was called with the right props — the panels were always rendered,
// and being rendered was exactly the problem.

const QUESTIONS: OpenQuestion[] = [
  {
    id: 'q-1',
    text: 'Does an expired refresh token log the session out, or re-prompt?',
    why: 'the plan branches on this',
    options: ['log out', 're-prompt'],
    recommended: 0,
    answer: null,
    rank: 9,
  },
  {
    id: 'q-2',
    text: 'Which clock does the expiry compare against?',
    why: '',
    options: ['server', 'client'],
    recommended: 0,
    answer: null,
    rank: 4,
  },
]

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-1',
      title: 'Refuse an expired refresh token',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/app'],
      now: '2026-09-06T10:00:00.000Z',
    }),
    ...over,
  }
}

function mountForge(questions: OpenQuestion[]) {
  const current = order({ openQuestions: questions })
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:order.compile') {
      return { order: current, compile: compileOrder(current) }
    }
    if (channel === 'foundry:run.recipes') {
      return {
        recipes: [{ name: 'standard', available: true, unmet: [], rung: 'built-in' }],
        proposed: 'standard',
      }
    }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  return render(<Forge orderId="WO-1" />)
}

// jsdom doesn't implement scrollIntoView, and openStep focuses the target.
window.HTMLElement.prototype.scrollIntoView = vi.fn()

beforeEach(() => vi.clearAllMocks())

async function openPlan(): Promise<void> {
  await waitFor(() => screen.getByRole('button', { name: /^Plan/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Plan/ }))
}

describe('the Forge puts its open questions on the Plan step', () => {
  it('renders them, with how many of them are decided in the group heading', async () => {
    mountForge(QUESTIONS)
    await openPlan()
    await waitFor(() => screen.getByText('Needs your answer'))
    expect(screen.getByText(/0 of 2 decided/)).toBeTruthy()
    expect(screen.getByText(QUESTIONS[0].text)).toBeTruthy()
  })

  it('is inside the Plan step, not a band above every step', async () => {
    const { container } = mountForge(QUESTIONS)
    await openPlan()
    await waitFor(() => screen.getByText('Needs your answer'))
    const group = screen.getByText('Needs your answer').closest('.fdry-group')
    expect(group?.closest('.fdry-wizard'), 'the group is inside the steps').not.toBeNull()
    expect(container.querySelector('.fdry-needs-you')).toBeNull()
  })

  it('takes no room at all when nothing is being asked', async () => {
    mountForge([])
    await openPlan()
    await waitFor(() => screen.getByRole('heading', { name: 'The plan and how it is proven' }))
    expect(screen.queryByText('Needs your answer')).toBeNull()
  })
})

// The Red team step now also holds every open blocking red-team finding — the
// other half of what a run of TAV-15 could not settle in one submit. A
// finding that does not make the change wrong (`process`, `pre-existing`,
// `infra`, `scope`) is a note the builder sees, never a reason to interrupt
// the operator.

async function openRedTeam(): Promise<void> {
  await waitFor(() => screen.getByRole('button', { name: /^Red team/ }))
  fireEvent.click(screen.getByRole('button', { name: /^Red team/ }))
}

function mountForgeWithOrder(over: Partial<WorkOrder>) {
  const current = order(over)
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:order.compile') {
      return { order: current, compile: compileOrder(current) }
    }
    if (channel === 'foundry:run.recipes') {
      return {
        recipes: [{ name: 'standard', available: true, unmet: [], rung: 'built-in' }],
        proposed: 'standard',
      }
    }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  return render(<Forge orderId="WO-1" />)
}

describe('the Red team step holds open findings, but only the ones that block need a decision', () => {
  it('puts a blocking finding in the "Needs your decision" group, with a way to decide it', async () => {
    mountForgeWithOrder({
      redTeam: [
        {
          id: 'RT-1',
          severity: 'high',
          category: 'wrong-outcome',
          text: 'the change would leave the outcome false',
          status: 'open',
          reason: '',
          round: 0,
        },
      ],
    })
    await openRedTeam()
    await waitFor(() => screen.getByText('Needs your decision'))
    const group = screen.getByText('Needs your decision').closest('.fdry-group') as HTMLElement
    expect(within(group).getByText('the change would leave the outcome false')).toBeTruthy()
    expect(within(group).getByRole('button', { name: 'Ask the architect' })).toBeTruthy()
  })

  it('puts a non-blocking finding in the neutral "Notes" group instead', async () => {
    mountForgeWithOrder({
      redTeam: [
        {
          id: 'RT-1',
          severity: 'low',
          category: 'process',
          text: 'the plan is fully serial',
          status: 'open',
          reason: '',
          round: 0,
        },
      ],
    })
    await openRedTeam()
    await waitFor(() => screen.getByText('Notes, nothing to do'))
    expect(screen.queryByText('Needs your decision')).toBeNull()
  })
})

// The Floor's half of the same problem.

const NODE = {
  id: 'N-1',
  unitId: 'U-1',
  lane: 1,
  role: 'builder',
  kind: 'agent',
  state: 'running',
  sessionId: 's-1',
  attempts: 1,
  reworks: 0,
  feedback: [],
  startedAt: null,
  endedAt: null,
  dependsOn: [],
  stepId: 'build',
}

const ASK = {
  requestId: 'r-1',
  sessionId: 's-1',
  toolName: 'Write',
  summary: 'Write src/auth/session.ts',
  detail: '{ "file_path": "src/auth/session.ts" }',
  at: 1,
}

function mountFloor(pending: unknown[]) {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') {
      return {
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [NODE] },
        ready: ['N-1'],
        blocked: [],
      }
    }
    if (channel === 'foundry:permissions-list') return { pending }
    if (channel === 'foundry:supervision-snapshot') return { review: [] }
    if (channel === 'foundry:stalls-list') return { firings: [], shadowMode: true }
    if (channel === 'foundry:feed-list') return { entries: [], mutes: [] }
    return { ok: true }
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
  return render(<Floor orderId="WO-1" />)
}

describe('the Floor puts a held tool call above the run graph', () => {
  it('renders the ask in the band', async () => {
    const { container } = mountFloor([ASK])
    await waitFor(() => expect(screen.getByText('Waiting on you — 1')).toBeTruthy())
    expect(container.querySelector('.fdry-needs-you')).not.toBeNull()
  })

  it('comes before the lanes rather than under all of them', async () => {
    const { container } = mountFloor([ASK])
    await waitFor(() => screen.getByText('Waiting on you — 1'))
    const band = container.querySelector('.fdry-needs-you')
    const lane = container.querySelector('.fdry-lane')
    expect(lane, 'no lane rendered, so the ordering assertion proves nothing').not.toBeNull()
    expect(band?.compareDocumentPosition(lane as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it('is absent when nothing is held', async () => {
    const { container } = mountFloor([])
    await waitFor(() => expect(container.querySelector('.fdry-lane')).not.toBeNull())
    expect(container.querySelector('.fdry-needs-you')).toBeNull()
  })
})

// And the count on the chrome, which is what makes the other two findable from
// anywhere rather than only from the surface they are already on.

function mountApp(attention: { inbox: number; forge: number }) {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:attention') return { ...attention, byOrder: {} }
    if (channel === 'foundry:inbox.list') {
      return {
        gates: [],
        summary: { waiting: 0, orders: 0, automatic: 0, building: 0, converging: 0 },
      }
    }
    if (channel === 'foundry:order.list') return { orders: [] }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    workspace: { list: vi.fn().mockResolvedValue({ workspaces: [] }) },
    project: { create: vi.fn() },
  }
  window.history.replaceState({}, '', '/?repoRoot=/repo')
  return render(<App />)
}

describe('the tab strip says how much is waiting', () => {
  it('counts each surface separately', async () => {
    const { container } = mountApp({ inbox: 3, forge: 2 })
    await waitFor(() => expect(container.querySelectorAll('.fdry-tab-count')).toHaveLength(2))
    const counts = [...container.querySelectorAll('.fdry-tab-count')].map((n) => n.textContent)
    expect(counts).toEqual(['3', '2'])
  })

  it('says what the number means, rather than reading out a bare digit', async () => {
    mountApp({ inbox: 3, forge: 0 })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Inbox, 3 waiting on you' })).toBeTruthy()
    )
  })

  it('leaves an unbadged tab addressable by its plain name', async () => {
    mountApp({ inbox: 3, forge: 0 })
    await waitFor(() => screen.getByRole('button', { name: 'Inbox, 3 waiting on you' }))
    expect(screen.getByRole('button', { name: 'Forge' })).toBeTruthy()
  })

  it('shows no badge at all when nothing is waiting', async () => {
    const { container } = mountApp({ inbox: 0, forge: 0 })
    await waitFor(() => screen.getByRole('button', { name: 'Inbox' }))
    expect(container.querySelectorAll('.fdry-tab-count')).toHaveLength(0)
  })

  it('never puts a count on the Ledger, which holds nothing for anybody', async () => {
    mountApp({ inbox: 3, forge: 2 })
    await waitFor(() => screen.getByRole('button', { name: 'Inbox, 3 waiting on you' }))
    expect(screen.getByRole('button', { name: 'Ledger' })).toBeTruthy()
  })
})
