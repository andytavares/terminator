import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { Forge } from '../../src/components/Forge.js'
import { Floor } from '../../src/components/Floor.js'
import { App } from '../../src/renderer/App.js'
import { draftOrder } from '../../src/order/schema.js'
import { compileOrder } from '../../src/order/compile.js'
import type { OpenQuestion, WorkOrder } from '../../src/order/schema.js'

// Where the things waiting on a person are on the screen.
//
// Foundry holds work for a person in three places, and every one of them used
// to be somewhere you had to already know about: the Forge's open questions
// third down a 260px rail under six checks and six recipe cards, the Floor's
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

beforeEach(() => vi.clearAllMocks())

describe('the Forge puts its open questions above everything else', () => {
  it('renders them, with the count in the heading', async () => {
    const { container } = mountForge(QUESTIONS)
    await waitFor(() => expect(container.querySelector('.fdry-needs-you')).not.toBeNull())
    expect(screen.getByText(/Needs you — 2/)).toBeTruthy()
    expect(screen.getByText(QUESTIONS[0].text)).toBeTruthy()
  })

  it('is not inside the rail it used to be buried in', async () => {
    const { container } = mountForge(QUESTIONS)
    await waitFor(() => expect(container.querySelector('.fdry-needs-you')).not.toBeNull())
    const band = container.querySelector('.fdry-needs-you')
    expect(band?.closest('.fdry-rail'), 'the band is back inside the rail').toBeNull()
  })

  it('comes before the rail and the document, not after them', async () => {
    const { container } = mountForge(QUESTIONS)
    await waitFor(() => expect(container.querySelector('.fdry-needs-you')).not.toBeNull())
    const band = container.querySelector('.fdry-needs-you')
    const rail = container.querySelector('.fdry-rail')
    const doc = container.querySelector('.fdry-doc')
    // DOCUMENT_POSITION_FOLLOWING: the argument comes after the node.
    expect(band?.compareDocumentPosition(rail as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
    expect(band?.compareDocumentPosition(doc as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    )
  })

  it('is the first thing in the Forge, so nothing can be scrolled past to reach it', async () => {
    const { container } = mountForge(QUESTIONS)
    await waitFor(() => expect(container.querySelector('.fdry-needs-you')).not.toBeNull())
    const forge = container.querySelector('.fdry-forge')
    expect(forge?.firstElementChild?.className).toContain('fdry-needs-you')
  })

  it('takes no room at all when nothing is being asked', async () => {
    const { container } = mountForge([])
    await waitFor(() => expect(container.querySelector('.fdry-rail')).not.toBeNull())
    expect(container.querySelector('.fdry-needs-you')).toBeNull()
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
