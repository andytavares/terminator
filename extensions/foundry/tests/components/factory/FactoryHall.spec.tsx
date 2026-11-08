import { createChangeBus } from '../../helpers/change-bus.js'
import { eventually } from '../../../../../tests/support/eventually'
import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FactoryHall } from '../../../src/components/factory/FactoryHall.js'
import { raiseGate } from '../../../src/gates/rules.js'
import { hallNode, hallView, pullRequestChecks } from '../../helpers/hall-views.js'

// The Factory surface for one order: its stations, attach, and opening the inbox for a gate.
// The canvas has no 2D context (pixels are `HallScene.spec.tsx`'s): a recording fake took
// 220,000 fillRect calls in the transcript test alone, past five seconds on a loaded machine.

let invoke: Mock<Window['electronAPI']['extensionBridge']['invoke']>
const openExternal = vi.fn(async () => ({ ok: true as const }))

interface MountProps {
  view?: Record<string, unknown>
  pending?: unknown[]
  activity?: Record<string, unknown>
  lines?: unknown[]
  metrics?: Record<string, unknown>[]
  onBack?: () => void
  onOpenInList?: () => void
}

/** What each channel answers for the hall `props` describe. */
function hallReplies(props: MountProps): Record<string, () => unknown> {
  return {
    'foundry:run.observe': () => props.view ?? hallView(),
    'foundry:permissions-list': () => ({ pending: props.pending ?? [] }),
    'foundry:run.activity': () => ({ activity: props.activity ?? {} }),
    'foundry:run-transcript': () => ({ lines: props.lines ?? [] }),
    'foundry:session.attach': () => ({ terminalSessionId: 't-1' }),
    'foundry:run-terminal': () => ({ ok: true }),
    'foundry:factory.metrics': () => ({ orders: props.metrics ?? [] }),
  }
}

function mount(props: MountProps = {}) {
  const onBack = props.onBack ?? vi.fn()
  const onOpenInList = props.onOpenInList ?? vi.fn()
  const replies = hallReplies(props)
  invoke = vi.fn(async (channel: string) => (channel in replies ? replies[channel]() : {}))
  Object.assign(window, {
    electronAPI: {
      usage: { record: vi.fn() },
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
      shell: { openExternal },
    },
  })
  render(<FactoryHall orderId="WO-1" onOpenInList={onOpenInList} onBack={onBack} />)
  return { onOpenInList, onBack }
}

/** A hall whose observation is `read()` on every read, and the bus that says it changed. */
function mountLive(read: () => unknown) {
  const bus = createChangeBus()
  const replies: Record<string, () => unknown> = {
    'foundry:run.observe': read,
    'foundry:permissions-list': () => ({ pending: [] }),
    'foundry:run.activity': () => ({ activity: {} }),
  }
  invoke = vi.fn(async (channel: string) => (channel in replies ? replies[channel]() : {}))
  vi.stubGlobal('electronAPI', {
    extensionBridge: { invoke, on: bus.on },
    usage: { record: vi.fn() },
  })
  render(<FactoryHall orderId="WO-1" onOpenInList={vi.fn()} onBack={vi.fn()} />)
  return bus
}

/** jsdom lays nothing out: give every box a size, and the hall one too. */
function sizeEveryBox(): void {
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
}

/** Two stations in the same state. */
function twoStations(state: string) {
  return hallView({
    graph: {
      orderId: 'WO-1',
      recipe: 'standard',
      nodes: [hallNode({ state }), hallNode({ id: 'N-2', sessionId: 's-2', state })],
    },
    labels: { 'N-1': 'Build the thing', 'N-2': 'Build the other' },
  })
}

/** A merge gate waiting on the gate station G, which follows a passed build. */
const MERGE_GATE = {
  id: 'g-1',
  rule: 'merge',
  orderId: 'WO-1',
  nodeId: 'G',
  summary: 'Merge the pull request?',
  why: 'Every check passed.',
  evidence: [],
  options: [
    { id: 'approve', label: 'Approve', consequence: 'Merges.' },
    { id: 'hold', label: 'Hold', consequence: 'Waits.' },
  ],
  defaultIfIgnored: 'hold',
  deadline: null,
  blockedUnits: 1,
  riskGrade: 'P2',
}

function waitingAtTheGate() {
  const gate = hallNode({
    id: 'G',
    kind: 'gate',
    state: 'waiting',
    sessionId: null,
    dependsOn: ['N-1'],
  })
  return hallView({
    graph: { orderId: 'WO-1', recipe: 'standard', nodes: [hallNode({ state: 'passed' }), gate] },
    waiting: [MERGE_GATE],
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FactoryHall status wall plumbing', () => {
  it('shows this order’s own metrics row on the status wall, not another order’s', async () => {
    mount({
      metrics: [
        { orderId: 'WO-2', title: 'Some other order', leadTimeMs: 1, reworks: 9, ciRounds: 9 },
        { orderId: 'WO-1', title: 'This one', leadTimeMs: 90_000, reworks: 1, ciRounds: 2 },
      ],
    })
    const wall = await screen.findByRole('img', { name: /^Lead time 2 min/ })
    expect(wall.getAttribute('aria-label')).toBe('Lead time 2 min · 1 rework · 2 CI fix rounds')
  })
})

function replayable(frames: unknown[], ci?: unknown[]) {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') return hallView()
    if (channel === 'foundry:permissions-list') return { pending: [] }
    if (channel === 'foundry:run.activity') return { activity: {} }
    if (channel === 'foundry:run.timeline')
      return {
        graph: hallView().graph,
        timeline: { frames, tools: [], ci },
        gates: [],
      }
    return {}
  })
  Object.assign(window, {
    electronAPI: {
      usage: { record: vi.fn() },
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    },
  })
  render(<FactoryHall orderId="WO-1" onOpenInList={vi.fn()} onBack={vi.fn()} />)
}
const plateText = () =>
  screen.getByRole('button', { name: /Build the thing/ }).getAttribute('aria-label')

describe('FactoryHall', () => {
  describe('addressing and badges', addressingAndBadgesTests)
  describe('pending asks', pendingAsksTests)
  describe('the standing band', theStandingBandTests)
  describe('gated moves', gatedMovesTests)
  describe('moves without a gate', movesWithoutAGateTests)
  describe('monitors', monitorsTests)
  describe('card summaries and plates', cardSummariesAndPlatesTests)
  describe('the order bar', theOrderBarTests)
  describe('callouts raised together', calloutsRaisedTogetherTests)
  describe('callouts on state change', calloutsOnStateChangeTests)
  describe('held tool calls', factoryHallHeldToolCallsTests)
  describe('waiting gates', factoryHallWaitingGatesTests)
  describe('parked agents', factoryHallParkedAgentsTests)
  describe('replaying', replayingTests)
  describe('replaying CI', replayingCiTests)
  describe('playback', playbackTests)
  describe('the site and failures', theSiteAndFailuresTests)
})

function addressingAndBadgesTests() {
  it('addresses a station by its label, role, state and attempt', async () => {
    mount()
    expect(
      await screen.findByRole('button', { name: 'Build the thing, builder, Working, attempt 1' })
    ).toBeTruthy()
  })

  it('leaves the station unbadged when nothing is waiting on the operator', async () => {
    mount()
    await screen.findByRole('button', { name: /Build the thing/ })
    const station = screen.getByRole('button', { name: /Build the thing/ })
    expect(station.querySelector('.fdry-hall-flag')).toBeNull()
  })

  it('flags a station whose session is stranded', async () => {
    mount({ view: hallView({ stranded: ['s-1'] }) })
    await screen.findByRole('button', { name: /Build the thing/ })
    const station = screen.getByRole('button', { name: /Build the thing/ })
    expect(station.querySelector('.fdry-hall-flag')).not.toBeNull()
  })
}

function pendingAsksTests() {
  it('flags a station holding a pending ask', async () => {
    mount({
      pending: [
        { requestId: 'r-1', sessionId: 's-1', toolName: 'Bash', summary: '', detail: null, at: 0 },
      ],
    })
    await screen.findByRole('button', { name: /Build the thing/ })
    const station = screen.getByRole('button', { name: /Build the thing/ })
    expect(station.querySelector('.fdry-hall-flag')).not.toBeNull()
  })
}

function theStandingBandTests() {
  it('shows the standing band only when it is the operator’s move', async () => {
    mount({
      view: hallView({
        standing: {
          kind: 'working',
          turn: 'foundry',
          label: '',
          headline: 'Building',
          detail: '',
          done: 0,
          total: 1,
          gateId: null,
        },
      }),
    })
    await screen.findByRole('button', { name: /Build the thing/ })
    expect(screen.queryByText('Building')).toBeNull()
  })
}

function gatedMovesTests() {
  // The gate itself is in the queue above the hall; the band names the move and
  // sends nobody to a surface that no longer exists.
  it('names a gated move without a button to somewhere else', async () => {
    mount({
      view: hallView({
        standing: {
          kind: 'halted',
          turn: 'you',
          label: 'halted',
          headline: 'Halted — your move',
          detail: '',
          done: 0,
          total: 1,
          gateId: 'g-1',
        },
      }),
    })
    await screen.findByText('Halted — your move')
    expect(screen.queryByRole('button', { name: 'Open in List view' })).toBeNull()
  })
}

function movesWithoutAGateTests() {
  it('sends a move with no gate behind it to the List view', async () => {
    const user = userEvent.setup()
    const { onOpenInList } = mount({
      view: hallView({
        standing: {
          kind: 'adrift',
          turn: 'you',
          label: 'adrift',
          headline: 'Nothing is running this',
          detail: '',
          done: 0,
          total: 1,
          gateId: null,
        },
      }),
    })
    await screen.findByText('Nothing is running this')
    await user.click(screen.getByRole('button', { name: 'Open in List view' }))
    expect(onOpenInList).toHaveBeenCalled()
  })
}

function monitorsTests() {
  it('opens a station’s monitor and attaches to it', async () => {
    const user = userEvent.setup()
    mount()
    await user.click(await screen.findByRole('button', { name: /Build the thing/ }))
    await screen.findByRole('button', { name: /ATTACH/ })
    await user.click(screen.getByRole('button', { name: /ATTACH/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:session.attach', {
        orderId: 'WO-1',
        nodeId: 'N-1',
      })
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-terminal', { sessionId: 't-1' })
    )
  })
}

function cardSummariesAndPlatesTests() {
  it('shows the waiting station’s own card summary on its monitor', async () => {
    const user = userEvent.setup()
    mount({
      view: hallView({
        waiting: [],
        stranded: ['s-1'],
      }),
    })
    await user.click(await screen.findByRole('button', { name: /Build the thing/ }))
    await screen.findByRole('heading', { name: 'BUILD THE THING' })
    expect(screen.getByRole('img', { name: 'Needs you' })).toBeTruthy()
    expect(screen.getByText(/^WAITING FOR YOU: WAITING IN ITS AGENT TAB/i)).toBeTruthy()
  })

  it('puts the full station label in the button title', async () => {
    mount()
    const station = await screen.findByRole('button', { name: /Build the thing/ })
    expect(station.getAttribute('title')).toContain('Build the thing')
  })
}

function theOrderBarTests() {
  it('keeps the order bar above the hall rather than over its top row', async () => {
    mount()
    const back = await screen.findByRole('button', { name: /All halls/ })
    const frame = document.querySelector('.fdry-hall-frame') as HTMLElement
    expect(frame.contains(back)).toBe(false)
    expect(back.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
}

function calloutsRaisedTogetherTests() {
  it('lifts callouts raised together clear of each other', async () => {
    sizeEveryBox()
    let current = twoStations('running')
    const bus = mountLive(() => current)
    await screen.findByRole('button', { name: /Build the other/ })
    current = twoStations('passed')
    bus.emit({ kind: 'graph', orderId: 'WO-1' })
    await eventually(() =>
      expect(document.querySelectorAll('.fdry-hall-overlay .fdry-callout')).toHaveLength(2)
    )
    const lifts = [...document.querySelectorAll<HTMLElement>('.fdry-callout')].map((c) =>
      c.style.getPropertyValue('--fdry-lift')
    )
    expect(new Set(lifts).size).toBe(2)
  })
}

function calloutsOnStateChangeTests() {
  it('raises a callout at the station when its state changes, not a line under the picture', async () => {
    let current = hallView()
    const bus = mountLive(() => current)
    await screen.findByRole('button', { name: /Build the thing/ })
    current = hallView({
      graph: { orderId: 'WO-1', recipe: 'standard', nodes: [hallNode({ state: 'passed' })] },
    })
    bus.emit({ kind: 'graph', orderId: 'WO-1' })
    await eventually(() => {
      const bubble = document.querySelector('.fdry-hall-overlay .fdry-callout') as HTMLElement
      expect(bubble.textContent).toBe('Done')
    })
  })
}

function factoryHallHeldToolCallsTests() {
  it('pins a held tool call over its station and answers it there', async () => {
    const user = userEvent.setup()
    mount({
      pending: [
        {
          requestId: 'r-1',
          sessionId: 's-1',
          toolName: 'Bash',
          summary: 'npm test',
          detail: null,
          at: 0,
        },
      ],
    })
    const card = await screen.findByRole('group', { name: 'Wants to run Bash' })
    expect(card.textContent).toContain('npm test')
    await user.click(within(card).getByRole('button', { name: 'Allow' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:permission-resolve', {
        requestId: 'r-1',
        decision: 'allow',
      })
    )
  })
}

function factoryHallWaitingGatesTests() {
  it('pins a waiting gate over the gate and decides it with the gate’s own options', async () => {
    const user = userEvent.setup()
    mount({ view: waitingAtTheGate() })
    const card = await screen.findByRole('group', { name: 'Merge the pull request?' })
    await user.click(within(card).getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'g-1',
        option: 'approve',
      })
    )
  })
}

function factoryHallParkedAgentsTests() {
  it('pins an agent parked at its terminal and takes you there', async () => {
    const user = userEvent.setup()
    mount({ view: hallView({ stranded: ['s-1'] }) })
    const card = await screen.findByRole('group', { name: 'Waiting in its agent tab' })
    await user.click(within(card).getByRole('button', { name: 'Go to agent tab' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-terminal', { sessionId: 's-1' })
    )
  })
}

function replayingTests() {
  it('replays the run from what was recorded, and scrubs to any moment of it', async () => {
    const user = userEvent.setup()
    replayable([
      { at: 1000, nodes: [{ id: 'N-1', state: 'running', attempts: 1, sessionId: 's-1' }] },
      { at: 9000, nodes: [{ id: 'N-1', state: 'passed', attempts: 1, sessionId: 's-1' }] },
    ])
    await user.click(await screen.findByRole('button', { name: 'Replay' }))
    const position = (await screen.findByRole('slider', {
      name: 'Replay position',
    })) as HTMLInputElement
    expect(invoke).toHaveBeenCalledWith('foundry:run.timeline', { id: 'WO-1' })
    expect(plateText()).toContain('Working')
    // eslint-disable-next-line testing-library/prefer-user-event -- user-event cannot move a range input to a value
    fireEvent.change(position, { target: { value: position.max } })
    await waitFor(() => expect(plateText()).toContain('Done'))
    await user.click(screen.getByRole('button', { name: 'Back to live' }))
    await waitFor(() =>
      expect(screen.queryByRole('slider', { name: 'Replay position' })).toBeNull()
    )
    expect(plateText()).toContain('Working')
  })
}

/** One pull request whose checks stand in the buckets given. */
const pullWith = (buckets: ('pass' | 'pending')[]) => [
  {
    url: 'https://github.com/a/b/pull/1',
    checks: buckets.map((bucket, i) => ({ name: `c${i}`, bucket, link: '', workflow: '' })),
  },
]

/** A build that ran from 1 s and passed at 9 s. */
const BUILD_FRAMES = [
  { at: 1000, nodes: [{ id: 'N-1', state: 'running', attempts: 1, sessionId: 's-1' }] },
  { at: 9000, nodes: [{ id: 'N-1', state: 'passed', attempts: 1, sessionId: 's-1' }] },
]

/** CI waiting on one of two checks from the start, green at 9 s. */
const CI_STATES = [
  { at: 0, round: 0, max: 2, status: 'watching', pulls: pullWith(['pass', 'pending']) },
  { at: 9000, round: 0, max: 2, status: 'green', pulls: pullWith(['pass', 'pass']) },
]

function replayingCiTests() {
  it('replays the wait on CI, and the tower to wait at, from what was recorded', async () => {
    const user = userEvent.setup()
    replayable(BUILD_FRAMES, CI_STATES)
    await user.click(await screen.findByRole('button', { name: 'Replay' }))
    const position = (await screen.findByRole('slider', {
      name: 'Replay position',
    })) as HTMLInputElement
    await waitFor(() =>
      expect(document.querySelector('.fdry-callout[data-pinned="true"]')?.textContent).toBe(
        'Waiting on checks · 1 of 2 done'
      )
    )
    // eslint-disable-next-line testing-library/prefer-user-event -- user-event cannot move a range input to a value
    fireEvent.change(position, { target: { value: position.max } })
    await waitFor(() =>
      expect(document.querySelector('.fdry-callout[data-pinned="true"]')).toBeNull()
    )
  })
}

function playbackTests() {
  it('plays, pauses and changes speed', async () => {
    const user = userEvent.setup()
    replayable([
      { at: 1000, nodes: [{ id: 'N-1', state: 'running', attempts: 1, sessionId: 's-1' }] },
      { at: 3000, nodes: [{ id: 'N-1', state: 'passed', attempts: 1, sessionId: 's-1' }] },
    ])
    // The replay's own clock, so a loaded machine cannot stretch its 750 ms.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      await user.click(await screen.findByRole('button', { name: 'Replay' }))
      await screen.findByRole('button', { name: 'Pause' })
      await user.click(await screen.findByRole('button', { name: '4x' }))
      expect(screen.getByRole('button', { name: '4x' }).getAttribute('aria-pressed')).toBe('true')
      // 3 s of recording at 4x is 750 ms of replay, in steps of 100 ms
      await act(() => vi.advanceTimersByTimeAsync(700))
      expect(plateText()).not.toContain('Done')
      await act(() => vi.advanceTimersByTimeAsync(100))
      expect(plateText()).toContain('Done')
      await screen.findByRole('button', { name: 'Play' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('says so when nothing was recorded for this run', async () => {
    const user = userEvent.setup()
    replayable([])
    await user.click(await screen.findByRole('button', { name: 'Replay' }))
    await screen.findByText('Nothing recorded for this run yet.')
    expect(screen.queryByRole('slider', { name: 'Replay position' })).toBeNull()
  })
}

function theSiteAndFailuresTests() {
  it('goes back to the site', async () => {
    const user = userEvent.setup()
    const { onBack } = mount()
    await screen.findByRole('button', { name: /Build the thing/ })
    await user.click(await screen.findByRole('button', { name: 'All halls' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('says nothing to attach to when the failure comes back', async () => {
    const user = userEvent.setup()
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:run.observe') return hallView()
      if (channel === 'foundry:permissions-list') return { pending: [] }
      if (channel === 'foundry:run.activity') return { activity: {} }
      if (channel === 'foundry:run-transcript') return { lines: [] }
      if (channel === 'foundry:session.attach') return { error: 'gone' }
      return {}
    })
    Object.assign(window, {
      electronAPI: {
        usage: { record: vi.fn() },
        extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
      },
    })
    render(<FactoryHall orderId="WO-1" onOpenInList={vi.fn()} onBack={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: /Build the thing/ }))
    await user.click(await screen.findByRole('button', { name: /ATTACH/ }))
    await screen.findByText('gone')
  })
}

describe('an open station monitor is live', () => {
  describe('reading the transcript', readingTheTranscriptTests)
  describe('no session', factoryHallNoSessionTests)
})

const ci = (buckets: ('pass' | 'pending')[]) => ({
  round: 0,
  max: 2,
  status: 'watching',
  reason: '',
  at: '2026-10-05T10:00:00.000Z',
  pulls: [pullRequestChecks('https://github.com/a/b/pull/233', buckets)],
})
const shipGraph = {
  orderId: 'WO-1',
  recipe: 'standard',
  nodes: [
    hallNode({ id: 'N-1', state: 'passed', sessionId: 's-1' }),
    hallNode({
      id: 'ship',
      kind: 'gate',
      state: 'running',
      role: null,
      sessionId: null,
      dependsOn: ['N-1'],
    }),
  ],
}

/** The bridge hands back a fresh array on every read; the fake would not. */
function freshLinesOnEveryRead(): void {
  const fake = invoke.getMockImplementation()!
  invoke.mockImplementation(async (channel: string, payload?: unknown) => {
    const r = (await fake(channel, payload)) as { lines?: unknown[] }
    return channel === 'foundry:run-transcript' ? { lines: [...(r.lines ?? [])] } : r
  })
}

function readingTheTranscriptTests() {
  const line = (text: string, at: number) => ({ role: 'assistant', kind: 'text', text, at })

  it('reads the transcript at once, then on the activity beat, and stops when closed', async () => {
    const lines = [line('first', 1)]
    mount({ lines })
    freshLinesOnEveryRead()
    const station = await screen.findByRole('button', { name: /Build the thing/ })
    // shouldAdvanceTime: Testing Library's async wrapper waits on a timer, or user-event hangs.
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    try {
      await user.click(station)
      await act(() => vi.advanceTimersByTimeAsync(0))

      const reads = () => invoke.mock.calls.filter((c) => c[0] === 'foundry:run-transcript')
      expect(reads().length).toBe(1)
      expect(reads()[0]![1]).toEqual({ sessionId: 's-1', limit: 40 })
      expect(screen.getByRole('log', { name: 'Transcript' }).textContent).toContain('first')

      lines.push(line('second', 2))
      await act(() => vi.advanceTimersByTimeAsync(2000))
      expect(reads().length).toBe(2)
      expect(screen.getByRole('log', { name: 'Transcript' }).textContent).toContain('second')

      await user.click(screen.getByRole('button', { name: 'Close monitor' }))
      await act(() => vi.advanceTimersByTimeAsync(300))
      expect(screen.queryByRole('log', { name: 'Transcript' })).toBeNull()
      await act(() => vi.advanceTimersByTimeAsync(6000))
      expect(reads().length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
}

function factoryHallNoSessionTests() {
  it('does not read a transcript for a station with no session', async () => {
    const user = userEvent.setup()
    mount({
      view: hallView({
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [hallNode({ sessionId: null })] },
      }),
    })
    await user.click(await screen.findByRole('button', { name: /Build the thing/ }))
    await screen.findByRole('log', { name: 'Transcript' })
    expect(invoke.mock.calls.some((c) => c[0] === 'foundry:run-transcript')).toBe(false)
    expect(screen.getByRole('log', { name: 'Transcript' }).textContent?.trim()).toBe('NOTHING YET.')
  })
}

describe('FactoryHall labels what it draws', () => {
  describe('the scoreboard', factoryHallTheScoreboardTests)
  describe('tower callouts', towerCalloutsTests)
  describe('finished monitors', finishedMonitorsTests)
  describe('a finished agent monitor', finishedAgentMonitorTests)
})

function readyGate(over: Partial<Parameters<typeof raiseGate>[0]> = {}) {
  return raiseGate({
    id: 'G-1',
    rule: 'ready-for-review',
    orderId: 'WO-1',
    summary: 'Mark the pull request ready for review',
    why: 'The work shipped as a draft:\n\n- the checks passed\n- nothing is blocked',
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  })
}

function factoryHallTheScoreboardTests() {
  it("names the scoreboard with this order's real figures", async () => {
    mount({
      metrics: [{ orderId: 'WO-1', leadTimeMs: 25 * 60_000, reworks: 0, ciRounds: 0 }],
    })
    expect(
      await screen.findByRole('img', { name: 'Lead time 25 min · 0 reworks · 0 CI fix rounds' })
    ).toBeTruthy()
  })
}

function towerCalloutsTests() {
  const shipView = (buckets: ('pass' | 'pending')[]) =>
    hallView({ graph: shipGraph, labels: { 'N-1': 'Build', ship: 'Ship' }, ci: ci(buckets) })

  it('keeps a callout pinned to the tower while checks are pending, and drops it when they land', async () => {
    const pending = [...Array(12).fill('pass'), ...Array(7).fill('pending')] as (
      'pass' | 'pending'
    )[]
    mount({ view: shipView(pending) })
    await waitFor(() =>
      expect(document.querySelector('.fdry-callout[data-pinned="true"]')?.textContent).toBe(
        'Waiting on checks · 12 of 19 done'
      )
    )
    expect(screen.getByRole('img', { name: 'Waiting on checks · 12 of 19 done' })).toBeTruthy()
  })

  it('pins no wait when every check has landed', async () => {
    mount({ view: shipView(['pass', 'pass']) })
    await screen.findByRole('img', { name: 'Checks · 2 passed · 0 failed' })
    expect(document.querySelector('.fdry-callout[data-pinned="true"]')).toBeNull()
  })
}

function finishedMonitorsTests() {
  it("opens the ship gate's monitor with what it decided and no attach key", async () => {
    const user = userEvent.setup()
    mount({
      view: hallView({
        graph: shipGraph,
        labels: { 'N-1': 'Build', ship: 'Ship' },
        ci: ci(['pass', 'pending']),
        pulls: [{ repo: 'a/b', url: 'https://github.com/a/b/pull/233', number: 233, cwd: '/x' }],
      }),
    })
    await user.click(await screen.findByRole('button', { name: /Ship/ }))
    const decided = await screen.findByRole('log', { name: 'What this step decided' })
    expect(decided.textContent).toBe('Draft opened · #233\nChecks · 1 of 2 passed')
    expect(screen.queryByRole('button', { name: /ATTACH/ })).toBeNull()
  })
}

function finishedAgentMonitorTests() {
  it("opens a finished agent's monitor with its transcript and attach disabled", async () => {
    const user = userEvent.setup()
    mount({
      view: hallView({
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [hallNode({ state: 'passed' })] },
      }),
      lines: [{ role: 'assistant', kind: 'text', text: 'All done.', at: 1 }],
    })
    await user.click(await screen.findByRole('button', { name: /Build the thing/ }))
    expect(await screen.findByText('All done.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Agent closed/i }).hasAttribute('disabled')).toBe(
      true
    )
  })
}

// A gate is one line with its answers on it, the reason a click away and written
// in markdown — the same card the list views draw, not a second rendering of it.
describe('FactoryHall gates and links', () => {
  describe('links', factoryHallLinksTests)
  describe('gate cards', gateCardsTests)
  describe('a ready-for-review gate', aReadyForReviewGateTests)
  describe('a new limit', aNewLimitTests)
})

function factoryHallLinksTests() {
  const pullUrl = 'https://github.com/andytavares/terminator/pull/233'

  const ticketUrl = 'https://linear.app/team/issue/TAV-15'

  it('links the pull request and the ticket on the heads-up bar', async () => {
    const user = userEvent.setup()
    mount({
      view: hallView({
        pulls: [{ repo: 'terminator', url: pullUrl, number: 233, cwd: '/wt' }],
        source: { key: 'TAV-15', url: ticketUrl },
      }),
    })
    const bar = await waitFor(() => {
      const found = document.querySelector('.fdry-hall-hud') as HTMLElement | null
      if (found === null) throw new Error('the heads-up bar is not drawn yet')
      return found
    })
    await user.click(within(bar).getByRole('link', { name: '#233' }))
    await user.click(within(bar).getByRole('link', { name: 'TAV-15' }))
    expect(openExternal).toHaveBeenCalledWith(pullUrl)
    expect(openExternal).toHaveBeenCalledWith(ticketUrl)
  })
}

function gateCardsTests() {
  it('bounds a gate card that opens below its station by the room down to the bottom edge', async () => {
    mount({ view: hallView({ waiting: [readyGate()] }) })
    await screen.findByRole('button', { name: 'Mark ready' })
    const card = document.querySelector('.fdry-card--gate') as HTMLElement
    // The default hall puts the station's foot 6 of 13 tiles down.
    expect(card.classList.contains('is-below')).toBe(true)
    expect(card.style.top).toBe('46.15384615384615%')
    expect(card.style.getPropertyValue('--fdry-card-room')).toBe('calc(53.84615384615385% - 26px)')
  })
}

function aReadyForReviewGateTests() {
  it('lets a shipped order\u2019s open ready-for-review gate be answered in the hall', async () => {
    const user = userEvent.setup()
    mount({
      view: hallView({
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [hallNode({ state: 'passed' })] },
        waiting: [readyGate()],
        standing: {
          kind: 'halted',
          turn: 'you',
          label: 'Mark the pull request ready for review',
          headline: 'Shipped \u2014 Mark the pull request ready for review',
          detail: '',
          done: 1,
          total: 1,
          gateId: 'G-1',
        },
      }),
    })
    await user.click(await screen.findByRole('button', { name: 'Mark ready' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'G-1',
        option: 'mark_ready',
      })
    )
  })
}

function aNewLimitTests() {
  it('offers to raise the budget on the card itself', async () => {
    mount({
      view: hallView({
        waiting: [
          raiseGate({
            id: 'G-2',
            rule: 'budget.exceeded',
            orderId: 'WO-1',
            summary: 'Past its time budget',
            why: 'The order budgets 60 and is at 61.',
            at: '2026-09-06T10:00:00.000Z',
            breach: { kind: 'wall_clock', limit: 60, actual: 61 },
          }),
        ],
      }),
    })
    await screen.findByText('Past its time budget')
    expect(screen.getByRole('button', { name: /Raise the budget/ })).toBeTruthy()
  })
}

const HANDED_BACK = {
  kind: 'claude-artifact',
  url: 'https://claude.ai/artifact/abc',
  path: '/o/r.md',
}
const DONE_STANDING = {
  kind: 'done',
  turn: 'foundry',
  label: 'done',
  headline: 'Done',
  detail: 'd',
  done: 1,
  total: 1,
  gateId: null,
}

describe('the document an order handed back', () => {
  const document = HANDED_BACK
  const done = DONE_STANDING

  it('links from the hall HUD, with a button to open it once the order is done', async () => {
    const user = userEvent.setup()
    mount({ view: hallView({ document, standing: done }) })
    const link = await screen.findByRole('link', { name: 'Claude artifact' })
    await user.click(link)
    expect(openExternal).toHaveBeenCalledWith(document.url)
    await user.click(screen.getByRole('button', { name: 'Open artifact' }))
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  it('links without the button while the order is still running', async () => {
    mount({ view: hallView({ document, standing: { ...done, kind: 'running' } }) })
    await screen.findByRole('link', { name: 'Claude artifact' })
    expect(screen.queryByRole('button', { name: 'Open artifact' })).toBeNull()
  })
})
