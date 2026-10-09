import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { App } from '../../src/renderer/App.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'

// Two surfaces and a way into settings. The board, the card drawer, the phase
// rail and the ticket importer are gone with the pipeline underneath them, so
// what is left to assert here is small — which is the point.

const bridgeHandlers: Record<string, (data: unknown) => void> = {}
let pendingNewOrder = false
let orderRows: unknown[] = []
let currentView: 'list' | 'factory' = 'list'
let observeStanding: unknown
let inboxWaiting: unknown[] = []

const mockBridgeInvoke = vi.fn(async (channel: string, payload?: unknown) => {
  if (channel === 'foundry:order.list') return { orders: orderRows }
  if (channel === 'foundry:models-list') {
    return { models: [{ id: '', label: 'Inherit', floating: true }], selected: '' }
  }
  if (channel === 'foundry:ledger.query') {
    return { entries: [], total: 0, actors: [], actions: [], orders: [] }
  }
  if (channel === 'foundry:inbox.list') {
    return {
      gates: [],
      waiting: inboxWaiting,
      summary: { waiting: 0, orders: 0, automatic: 0, building: 0, converging: 0 },
    }
  }
  if (channel === 'foundry:ui.consume-pending-new-order') {
    return { pending: pendingNewOrder }
  }
  if (channel === 'foundry:ui.view') return { view: currentView }
  if (channel === 'foundry:ui.set-view') {
    const view = (payload as { view?: string }).view
    currentView = view === 'factory' ? 'factory' : 'list'
    return { view: currentView }
  }
  if (channel === 'foundry:run.observe') {
    const { id } = (payload as { id?: string }) ?? {}
    return {
      graph: {
        orderId: id ?? 'WO-1',
        recipe: 'standard',
        nodes: [
          {
            id: 'N-1',
            stepId: 'build',
            kind: 'agent',
            state: 'running',
            unitIds: [],
            lane: null,
            role: 'builder',
            dependsOn: [],
            attempts: 1,
            reworks: 0,
            feedback: [],
            sessionId: null,
            worktreePath: null,
            startedAt: null,
            endedAt: null,
          },
        ],
      },
      labels: { 'N-1': 'Builder' },
      ready: [],
      blocked: [],
      standing: observeStanding,
    }
  }
  if (channel === 'foundry:run.activity') return { activity: {} }
  if (channel === 'foundry:permissions-list') return { pending: [] }
  if (channel === 'foundry:run-transcript') return { lines: [] }
  if (channel === 'foundry:order.compile') {
    const shapingOrder = draftOrder({
      id: 'WO-2',
      title: 'Still shaping',
      source: { kind: 'typed', text: 'still shaping' },
      repoPaths: ['/repo'],
      now: '2026-09-06T10:00:00.000Z',
    })
    return { order: shapingOrder, compile: compileOrder(shapingOrder) }
  }
  if (channel === 'foundry:order.states') return { supported: false }
  if (channel === 'foundry:run.recipes') return { recipes: [], proposed: 'standard' }
  return {}
})

beforeEach(() => {
  vi.clearAllMocks()
  pendingNewOrder = false
  orderRows = []
  inboxWaiting = []
  currentView = 'list'
  observeStanding = undefined
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  } as unknown as CanvasRenderingContext2D)
  for (const key of Object.keys(bridgeHandlers)) delete bridgeHandlers[key]
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: {
      on: vi.fn((event: string, handler: (data: unknown) => void) => {
        bridgeHandlers[event] = handler
        return vi.fn()
      }),
      invoke: mockBridgeInvoke,
    },
    workspace: { list: vi.fn().mockResolvedValue({ workspaces: [] }) },
    project: { create: vi.fn() },
  }
  window.history.replaceState({}, '', '/?repoRoot=/repo')
})

const waitingRow = {
  orderId: 'WO-1008-287',
  title: 'render html in comments',
  headline: 'Ready to hand off',
  detail: 'Every check passes.',
}

describe('App', () => {
  it('opens on the Forge', async () => {
    render(<App />)
    expect(screen.getByText('Foundry')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeTruthy())
  })

  // The Inbox was a tab of its own, and with nothing waiting it was a page with
  // nothing on it — the page the operator landed on.
  it('has no Inbox tab', () => {
    render(<App />)
    expect(screen.queryByRole('button', { name: /^Inbox/ })).toBeNull()
  })

  it('shows nothing above the Forge when nothing is waiting', async () => {
    render(<App />)
    await waitFor(() => screen.getByText(/no orders yet/i))
    await waitFor(() => expect(mockBridgeInvoke).toHaveBeenCalledWith('foundry:inbox.list', {}))
    expect(screen.queryByRole('region', { name: 'Waiting on you' })).toBeNull()
  })

  it('puts what is waiting above the Forge, before anything else on it', async () => {
    inboxWaiting = [waitingRow]
    render(<App />)
    const band = await screen.findByRole('region', { name: 'Waiting on you' })
    const forge = await screen.findByText(/no orders yet/i)
    expect(band.textContent).toContain('render html in comments')
    expect(band.compareDocumentPosition(forge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('keeps what is waiting above the factory view too', async () => {
    inboxWaiting = [waitingRow]
    currentView = 'factory'
    render(<App />)
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Factory view' }).getAttribute('aria-pressed')
      ).toBe('true')
    )
    expect(await screen.findByRole('region', { name: 'Waiting on you' })).toBeTruthy()
  })

  it('does not put it over the Ledger', async () => {
    inboxWaiting = [waitingRow]
    render(<App />)
    await screen.findByRole('region', { name: 'Waiting on you' })
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    await waitFor(() => screen.getByText('Nothing recorded yet.'))
    expect(screen.queryByRole('region', { name: 'Waiting on you' })).toBeNull()
  })

  it('marks which surface is showing, for anything reading state rather than colour', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Ledger' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })

  it('opens settings and comes back', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => expect(screen.getByRole('button', { name: /back/i })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /back/i }))
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeTruthy())
  })

  // Settings covers the surfaces rather than sitting beside them, so while it
  // is open none of the tabs is the one showing — and a tab clicked from inside
  // it has to bring you back out, or it changes a surface nobody can see.
  it('marks no surface as showing while settings covers them', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: 'Ledger' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })

  it('says the gear is the thing that is pressed', async () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    )
  })

  it('leaves settings when a surface tab is clicked, rather than doing nothing visible', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /back/i })).toBeNull())
    expect(screen.getByRole('button', { name: 'Ledger' }).getAttribute('aria-pressed')).toBe('true')
  })

  // A waiting row names an order; its button has to land on that order, not on
  // the Forge's list where it is one row of many.
  it('opens a waiting order in the Forge', async () => {
    orderRows = [
      {
        id: 'WO-1008-287',
        title: 'render html in comments',
        status: 'draft',
        risk: 'low',
        failures: 0,
        source: { kind: 'typed', tracker: null, key: null },
        standing: {
          kind: 'shaping',
          turn: 'you',
          label: 'ready to hand off',
          headline: 'Ready to hand off',
          detail: '',
          done: 0,
          total: 0,
          gateId: null,
        },
      },
    ]
    inboxWaiting = [waitingRow]
    render(<App />)
    fireEvent.click(
      await screen.findByRole('button', { name: 'Open render html in comments in the Forge' })
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'All orders' })).toBeTruthy())
  })

  it('closes settings when the workspace changes underneath it', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    bridgeHandlers['workspace:changed']({ repoRoot: '/other' })
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeTruthy())
  })
})

describe('the Ledger surface', () => {
  it('is reachable from its own tab', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    await waitFor(() => expect(screen.getByText('Nothing recorded yet.')).toBeTruthy())
  })

  it('comes back to the Forge', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    await waitFor(() => screen.getByText('Nothing recorded yet.'))
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeTruthy())
  })
})

describe('the New work order quick action', () => {
  it('brings the Forge forward and focuses the idea box when the extension asks', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    await waitFor(() => screen.getByText('Nothing recorded yet.'))
    bridgeHandlers['foundry:ui.open-new-order']({})
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText('Describe what you want built or fixed')
      )
    )
  })

  it('leaves settings open on a surface the operator can see', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    bridgeHandlers['foundry:ui.open-new-order']({})
    await waitFor(() => expect(screen.queryByRole('button', { name: /back/i })).toBeNull())
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('picks up a request made before this view existed', async () => {
    pendingNewOrder = true
    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    )
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByLabelText('Describe what you want built or fixed')
      )
    )
  })
})

// The toggle only exists on the Forge surface — the Ledger and Settings draw
// exactly as they did before this feature.
describe('the Factory view toggle', () => {
  it('is not offered outside the Forge', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    await waitFor(() => screen.getByText('Nothing recorded yet.'))
    expect(screen.queryByRole('button', { name: 'Factory view' })).toBeNull()
  })

  it('starts on List, unless the setting already says Factory', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByRole('button', { name: 'List view' }))
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
    expect(screen.getByText(/no orders yet/i)).toBeTruthy()
  })

  it('switches to the hall grid and persists the choice', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByRole('button', { name: 'Factory view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Factory view' }))
    await waitFor(() =>
      expect(mockBridgeInvoke).toHaveBeenCalledWith('foundry:ui.set-view', { view: 'factory' })
    )
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeTruthy())
    expect(screen.getByRole('button', { name: 'Factory view' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('follows a view change broadcast from elsewhere', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByRole('button', { name: 'List view' }))
    bridgeHandlers['foundry:ui.view-changed']({ view: 'factory' })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Factory view' }).getAttribute('aria-pressed')
      ).toBe('true')
    )
  })

  it('opens a working order in the hall, and a shaping one back in the list', async () => {
    orderRows = [
      {
        id: 'WO-1',
        title: 'Working order',
        status: 'running',
        risk: 'low',
        failures: 0,
        source: { kind: 'typed', tracker: null, key: null },
        standing: {
          kind: 'working',
          turn: 'foundry',
          label: 'building',
          headline: 'Building',
          detail: '',
          done: 0,
          total: 1,
          gateId: null,
        },
      },
    ]
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByRole('button', { name: 'Factory view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Factory view' }))
    await waitFor(() => screen.getByText('Working order'))
    fireEvent.click(screen.getByRole('button', { name: /Working order/ }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'All halls' })).toBeTruthy())
  })

  it('sends a shaping order back to the list, open', async () => {
    orderRows = [
      {
        id: 'WO-2',
        title: 'Still shaping',
        status: 'draft',
        risk: 'low',
        failures: 0,
        source: { kind: 'typed', tracker: null, key: null },
      },
    ]
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByRole('button', { name: 'Factory view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Factory view' }))
    await waitFor(() => screen.getByText('Still shaping'))
    fireEvent.click(screen.getByRole('button', { name: /Still shaping/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    )
    expect(screen.queryByRole('button', { name: 'All halls' })).toBeNull()
  })

  it('flips back to List from Factory through the toggle', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByRole('button', { name: 'Factory view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Factory view' }))
    await waitFor(() => screen.getByText(/no orders yet/i))
    fireEvent.click(screen.getByRole('button', { name: 'List view' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    )
    expect(screen.getByText(/no orders yet/i)).toBeTruthy()
  })

  // The gate is in the queue above the hall, so the hall's own band no longer
  // sends you anywhere to find it.
  it('keeps a gated hall under the queue that answers it', async () => {
    inboxWaiting = [waitingRow]
    orderRows = [
      {
        id: 'WO-1',
        title: 'Working order',
        status: 'running',
        risk: 'low',
        failures: 0,
        source: { kind: 'typed', tracker: null, key: null },
        standing: {
          kind: 'working',
          turn: 'foundry',
          label: 'building',
          headline: 'Building',
          detail: '',
          done: 0,
          total: 1,
          gateId: null,
        },
      },
    ]
    observeStanding = {
      kind: 'halted',
      turn: 'you',
      label: 'halted',
      headline: 'Halted — your move',
      detail: '',
      done: 0,
      total: 1,
      gateId: 'g-1',
    }
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByRole('button', { name: 'Factory view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Factory view' }))
    await waitFor(() => screen.getByText('Working order'))
    fireEvent.click(screen.getByRole('button', { name: /Working order/ }))
    await waitFor(() => screen.getByText('Halted — your move'))
    expect(screen.getByRole('region', { name: 'Waiting on you' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open Inbox' })).toBeNull()
  })

  it('opens a hall band with no gate behind it in the List view', async () => {
    orderRows = [
      {
        id: 'WO-1',
        title: 'Working order',
        status: 'running',
        risk: 'low',
        failures: 0,
        source: { kind: 'typed', tracker: null, key: null },
        standing: {
          kind: 'working',
          turn: 'foundry',
          label: 'building',
          headline: 'Building',
          detail: '',
          done: 0,
          total: 1,
          gateId: null,
        },
      },
    ]
    observeStanding = {
      kind: 'adrift',
      turn: 'you',
      label: 'adrift',
      headline: 'Nothing is running this',
      detail: '',
      done: 0,
      total: 1,
      gateId: null,
    }
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
    await waitFor(() => screen.getByRole('button', { name: 'Factory view' }))
    fireEvent.click(screen.getByRole('button', { name: 'Factory view' }))
    await waitFor(() => screen.getByText('Working order'))
    fireEvent.click(screen.getByRole('button', { name: /Working order/ }))
    await waitFor(() => screen.getByText('Nothing is running this'))
    fireEvent.click(screen.getByRole('button', { name: 'Open in List view' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    )
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('true')
  })
})
