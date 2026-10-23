import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { App } from '../../src/renderer/App.js'
import '../helpers/app-views.js'
import { draftOrder } from '../../src/order/draft.js'
import { compileOrder } from '../../src/order/compile.js'
import { partialFake } from '../../../../tests/support/fakes'
import { timesInvoked } from '../helpers/bridge-calls.js'

// Two surfaces and a way into settings. The board, the card drawer, the phase
// rail and the ticket importer are gone with the pipeline underneath them, so
// what is left to assert here is small — which is the point.

const bridgeHandlers: Record<string, (data: unknown) => void> = {}
/** Every handler, for events several parts of the window listen to. */
const everyHandler: Record<string, ((data: unknown) => void)[]> = {}
let pendingNewOrder = false
let orderRows: unknown[] = []
let currentView: 'list' | 'factory' = 'list'
let observeStanding: unknown
let inboxWaiting: unknown[] = []

/** The one node a run of WO-1 shows, building. */
const BUILDING_NODE = {
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
}

function observedRun(payload: unknown) {
  const { id } = (payload as { id?: string }) ?? {}
  return {
    graph: { orderId: id ?? 'WO-1', recipe: 'standard', nodes: [BUILDING_NODE] },
    labels: { 'N-1': 'Builder' },
    ready: [],
    blocked: [],
    standing: observeStanding,
  }
}

function compiledShapingOrder() {
  const shapingOrder = draftOrder({
    id: 'WO-2',
    title: 'Still shaping',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repo'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { order: shapingOrder, compile: compileOrder(shapingOrder) }
}

function setViewReply(payload: unknown) {
  const view = (payload as { view?: string }).view
  currentView = view === 'factory' ? 'factory' : 'list'
  return { view: currentView }
}

/** What each channel answers; a channel not listed answers `{}`. */
const replies: Record<string, (payload: unknown) => unknown> = {
  'foundry:order.list': () => ({ orders: orderRows }),
  'foundry:models-list': () => ({
    models: [{ id: '', label: 'Inherit', floating: true }],
    selected: '',
  }),
  'foundry:ledger.query': () => ({ entries: [], total: 0, actors: [], actions: [], orders: [] }),
  'foundry:inbox.list': () => ({
    gates: [],
    waiting: inboxWaiting,
    summary: { waiting: 0, orders: 0, automatic: 0, building: 0, converging: 0 },
  }),
  'foundry:ui.consume-pending-new-order': () => ({ pending: pendingNewOrder }),
  'foundry:ui.view': () => ({ view: currentView }),
  'foundry:ui.set-view': setViewReply,
  'foundry:run.observe': observedRun,
  'foundry:run.activity': () => ({ activity: {} }),
  'foundry:permissions-list': () => ({ pending: [] }),
  'foundry:run-transcript': () => ({ lines: [] }),
  'foundry:order.compile': compiledShapingOrder,
  'foundry:order.states': () => ({ supported: false }),
  'foundry:run.recipes': () => ({ recipes: [], proposed: 'standard' }),
}

const answerFromReplies = async (channel: string, payload?: unknown): Promise<unknown> =>
  channel in replies ? replies[channel](payload) : {}

const mockBridgeInvoke = vi.fn(answerFromReplies)

/** The canvas members the factory views draw with; jsdom has no canvas. */
function fakeCanvasContext(): CanvasRenderingContext2D {
  return partialFake<CanvasRenderingContext2D>({
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks keeps an implementation a test installed, so the next test would inherit it.
  mockBridgeInvoke.mockImplementation(answerFromReplies)
  pendingNewOrder = false
  orderRows = []
  inboxWaiting = []
  currentView = 'list'
  observeStanding = undefined
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCanvasContext())
  for (const key of Object.keys(bridgeHandlers)) delete bridgeHandlers[key]
  for (const key of Object.keys(everyHandler)) delete everyHandler[key]
  Object.assign(window, {
    electronAPI: {
      extensionBridge: {
        on: vi.fn((event: string, handler: (data: unknown) => void) => {
          bridgeHandlers[event] = handler
          everyHandler[event] = [...(everyHandler[event] ?? []), handler]
          return vi.fn()
        }),
        invoke: mockBridgeInvoke,
      },
      workspace: { list: vi.fn().mockResolvedValue({ workspaces: [] }) },
      project: { create: vi.fn() },
    },
  })
  window.history.replaceState({}, '', '/?repoRoot=/repo')
})

const waitingRow = {
  orderId: 'WO-1008-287',
  title: 'render html in comments',
  headline: 'Ready to hand off',
  detail: 'Every check passes.',
}

/** A running order the Factory view draws as a hall. */
const WORKING_ROW = {
  id: 'WO-1',
  title: 'Working order',
  status: 'running',
  risk: 'low',
  failures: 0,
  source: { kind: 'typed', tracker: null, key: null },
  standing: stepStanding({
    kind: 'working',
    turn: 'foundry',
    label: 'building',
    headline: 'Building',
  }),
}

/** A standing for one step, with no gate unless one is named. */
function stepStanding(over: {
  kind: string
  turn: string
  label: string
  headline: string
  gateId?: string
}) {
  return { detail: '', done: 0, total: 1, gateId: null, ...over }
}

/** Opens the Forge in the Factory view and steps into the working order's hall. */
async function openWorkingHall() {
  orderRows = [WORKING_ROW]
  render(<App />)
  fireEvent.click(screen.getByRole('button', { name: 'Forge' }))
  await waitFor(() => screen.getByRole('button', { name: 'Factory view' }))
  fireEvent.click(screen.getByRole('button', { name: 'Factory view' }))
  fireEvent.click(await screen.findByRole('button', { name: /Working order/ }))
}

describe('App', () => {
  describe('the Forge', theForgeTests)
  describe('what is waiting', whatIsWaitingTests)
  describe('the surface showing', theSurfaceShowingTests)
  describe('settings', appSettingsTests)
  describe('leaving settings', leavingSettingsTests)
  describe('a waiting order', aWaitingOrderTests)
  describe('a workspace change', aWorkspaceChangeTests)
})

function theForgeTests() {
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
}

function whatIsWaitingTests() {
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
}

function theSurfaceShowingTests() {
  it('marks which surface is showing, for anything reading state rather than colour', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Ledger' }).getAttribute('aria-pressed')).toBe(
      'false'
    )
  })
}

function appSettingsTests() {
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
}

function leavingSettingsTests() {
  it('leaves settings when a surface tab is clicked, rather than doing nothing visible', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Ledger' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /back/i })).toBeNull())
    expect(screen.getByRole('button', { name: 'Ledger' }).getAttribute('aria-pressed')).toBe('true')
  })
}

function aWaitingOrderTests() {
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
}

function aWorkspaceChangeTests() {
  it('has nowhere to start an order once the workspace closes', async () => {
    render(<App />)
    const idea = await screen.findByRole('textbox', {
      name: 'Describe what you want built or fixed',
    })
    expect((idea as HTMLInputElement).disabled).toBe(false)
    act(() => everyHandler['workspace:changed'].forEach((handler) => handler({})))
    await waitFor(() => expect((idea as HTMLInputElement).disabled).toBe(true))
  })

  it('closes settings when the workspace changes underneath it', async () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    await waitFor(() => screen.getByRole('button', { name: /back/i }))
    act(() =>
      everyHandler['workspace:changed'].forEach((handler) => handler({ repoRoot: '/other' }))
    )
    await waitFor(() => expect(screen.getByText(/no orders yet/i)).toBeTruthy())
  })
}

/** The counts read once, then a read that fails after the next change. */
async function keepsTheLastCountWhenAReadFails(): Promise<void> {
  let reads = 0
  mockBridgeInvoke.mockImplementation(async (channel: string, payload?: unknown) => {
    if (channel !== 'foundry:attention') return channel in replies ? replies[channel](payload) : {}
    reads += 1
    if (reads > 1) throw new Error('the extension host restarted')
    return { inbox: 2, forge: 1 }
  })
  render(<App />)
  await screen.findByRole('button', { name: 'Forge, 3 waiting on you' })

  everyHandler['foundry:changed'].forEach((handler) => handler({ kind: 'gates', orderId: 'WO-1' }))
  await waitFor(() => expect(reads).toBe(2))
  expect(screen.getByRole('button', { name: 'Forge, 3 waiting on you' })).toBeTruthy()
}

describe('the counts on the chrome', () => {
  it('are read on mount, then again only when Foundry says something changed', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<App />)
    await waitFor(() => expect(timesInvoked(mockBridgeInvoke, 'foundry:attention')).toBe(1))

    await vi.advanceTimersByTimeAsync(60_000)
    expect(timesInvoked(mockBridgeInvoke, 'foundry:attention')).toBe(1)
    vi.useRealTimers()

    everyHandler['foundry:changed'].forEach((handler) =>
      handler({ kind: 'gates', orderId: 'WO-1' })
    )
    await waitFor(() => expect(timesInvoked(mockBridgeInvoke, 'foundry:attention')).toBe(2))
  })

  it('leave the last count up when a later read fails', keepsTheLastCountWhenAReadFails)

  it('are read again when the workspace switches, which writes nothing to say so', async () => {
    render(<App />)
    await waitFor(() => expect(timesInvoked(mockBridgeInvoke, 'foundry:attention')).toBe(1))

    everyHandler['workspace:changed'].forEach((handler) => handler({ repoRoot: '/other' }))
    await waitFor(() => expect(timesInvoked(mockBridgeInvoke, 'foundry:attention')).toBe(2))
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
  describe('the Forge brought forward', theForgeBroughtForwardTests)
  describe('an earlier request', anEarlierRequestTests)
})

function theForgeBroughtForwardTests() {
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
}

function anEarlierRequestTests() {
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
}

// The toggle only exists on the Forge surface — the Ledger and Settings draw
// exactly as they did before this feature.
describe('the Factory view toggle', () => {
  describe('where it is offered and starts', whereItIsOfferedAndStartsTests)
  describe('switching', appSwitchingTests)
  describe('opening orders', openingOrdersTests)
  describe('a shaping order', aShapingOrderTests)
  describe('flipping back', flippingBackTests)
  describe('a gated hall', aGatedHallTests)
  describe('a hall band without a gate', aHallBandWithoutAGateTests)
  describe('an unreadable view', unreadableViewTests)
  describe('leaving a hall', leavingAHallTests)
})

function whereItIsOfferedAndStartsTests() {
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
    // The order list loads after the view switcher draws.
    expect(await screen.findByText(/no orders yet/i)).toBeTruthy()
  })
}

function appSwitchingTests() {
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
}

/** A view changed to List elsewhere while this one showed the factory. */
async function followsABroadcastBackToTheList(): Promise<void> {
  currentView = 'factory'
  render(<App />)
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Factory view' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  )
  act(() => bridgeHandlers['foundry:ui.view-changed']({ view: 'list' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  )
}

function unreadableViewTests() {
  it('starts on List when the saved view cannot be read', async () => {
    mockBridgeInvoke.mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel === 'foundry:ui.view') throw new Error('settings unavailable')
      return channel in replies ? replies[channel](payload) : {}
    })
    render(<App />)
    await waitFor(() => expect(mockBridgeInvoke).toHaveBeenCalledWith('foundry:ui.view'))
    expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
      'true'
    )
  })

  it('opens on the Forge when an earlier new-order request cannot be read', async () => {
    mockBridgeInvoke.mockImplementation(async (channel: string, payload?: unknown) => {
      if (channel === 'foundry:ui.consume-pending-new-order') throw new Error('host gone')
      return channel in replies ? replies[channel](payload) : {}
    })
    render(<App />)
    await waitFor(() =>
      expect(mockBridgeInvoke).toHaveBeenCalledWith('foundry:ui.consume-pending-new-order')
    )
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('follows a view change broadcast back to the list', followsABroadcastBackToTheList)
}

function leavingAHallTests() {
  it('comes back from a hall to the grid of every hall', async () => {
    await openWorkingHall()
    fireEvent.click(await screen.findByRole('button', { name: 'All halls' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'All halls' })).toBeNull())
    expect(screen.getByRole('button', { name: /Working order/ })).toBeTruthy()
  })
}

function openingOrdersTests() {
  it('opens a working order in the hall, and a shaping one back in the list', async () => {
    await openWorkingHall()
    await waitFor(() => expect(screen.getByRole('button', { name: 'All halls' })).toBeTruthy())
  })
}

function aShapingOrderTests() {
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
    fireEvent.click(await screen.findByRole('button', { name: /Still shaping/ }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    )
    expect(screen.queryByRole('button', { name: 'All halls' })).toBeNull()
  })
}

function flippingBackTests() {
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
}

function aGatedHallTests() {
  // The gate is in the queue above the hall, so the hall's own band no longer
  // sends you anywhere to find it.
  it('keeps a gated hall under the queue that answers it', async () => {
    inboxWaiting = [waitingRow]
    observeStanding = stepStanding({
      kind: 'halted',
      turn: 'you',
      label: 'halted',
      headline: 'Halted — your move',
      gateId: 'g-1',
    })
    await openWorkingHall()
    await waitFor(() => screen.getByText('Halted — your move'))
    expect(screen.getByRole('region', { name: 'Waiting on you' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open Inbox' })).toBeNull()
  })
}

function aHallBandWithoutAGateTests() {
  it('opens a hall band with no gate behind it in the List view', async () => {
    observeStanding = stepStanding({
      kind: 'adrift',
      turn: 'you',
      label: 'adrift',
      headline: 'Nothing is running this',
    })
    await openWorkingHall()
    await waitFor(() => screen.getByText('Nothing is running this'))
    fireEvent.click(screen.getByRole('button', { name: 'Open in List view' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'List view' }).getAttribute('aria-pressed')).toBe(
        'true'
      )
    )
    expect(screen.getByRole('button', { name: 'Forge' }).getAttribute('aria-pressed')).toBe('true')
  })
}
