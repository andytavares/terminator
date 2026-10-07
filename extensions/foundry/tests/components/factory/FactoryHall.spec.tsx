import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { FactoryHall } from '../../../src/components/factory/FactoryHall.js'
import { raiseGate } from '../../../src/gates/rules.js'

// The Factory surface for one order: a hall drawn from the run graph, a
// station per node, and the two moves this view keeps — attach, and opening
// the inbox to decide a gate. Everything else stays in the List view.
//
// jsdom has no canvas, so `HallScene`'s 2D context is a fake this spec never
// inspects: the point here is what the stations and the drawer say, not the
// pixels `HallScene.spec.tsx` already covers.

function fakeContext2D() {
  return {
    fillStyle: '#000',
    globalCompositeOperation: 'source-over',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
}

function node(over: Record<string, unknown> = {}) {
  return {
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
    sessionId: 's-1',
    worktreePath: null,
    startedAt: null,
    endedAt: null,
    ...over,
  }
}

function view(over: Record<string, unknown> = {}) {
  return {
    graph: { orderId: 'WO-1', recipe: 'standard', nodes: [node()] },
    labels: { 'N-1': 'Build the thing' },
    ready: [],
    blocked: [],
    orphaned: [],
    stranded: [],
    waiting: [],
    ...over,
  }
}

let invoke: ReturnType<typeof vi.fn>
const openExternal = vi.fn()

function mount(
  props: {
    view?: Record<string, unknown>
    pending?: unknown[]
    activity?: Record<string, unknown>
    lines?: unknown[]
    metrics?: Record<string, unknown>[]
    onOpenInbox?: () => void
    onBack?: () => void
    onOpenInList?: () => void
  } = {}
) {
  const onOpenInbox = props.onOpenInbox ?? vi.fn()
  const onBack = props.onBack ?? vi.fn()
  const onOpenInList = props.onOpenInList ?? vi.fn()
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') return props.view ?? view()
    if (channel === 'foundry:permissions-list') return { pending: props.pending ?? [] }
    if (channel === 'foundry:run.activity') return { activity: props.activity ?? {} }
    if (channel === 'foundry:run-transcript') return { lines: props.lines ?? [] }
    if (channel === 'foundry:session.attach') return { terminalSessionId: 't-1' }
    if (channel === 'foundry:run-terminal') return { ok: true }
    if (channel === 'foundry:factory.metrics') return { orders: props.metrics ?? [] }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    shell: { openExternal },
  }
  render(
    <FactoryHall
      orderId="WO-1"
      onOpenInbox={onOpenInbox}
      onOpenInList={onOpenInList}
      onBack={onBack}
    />
  )
  return { onOpenInbox, onOpenInList, onBack }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    fakeContext2D() as unknown as CanvasRenderingContext2D
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('FactoryHall status wall plumbing', () => {
  it('fetches this order’s own metrics row for the status wall', async () => {
    mount({
      metrics: [
        { orderId: 'WO-1', title: 'This one', leadTimeMs: 90_000, reworks: 1, ciRounds: 2 },
        { orderId: 'WO-2', title: 'Some other order', leadTimeMs: 1, reworks: 9, ciRounds: 9 },
      ],
    })
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:factory.metrics', { window: 'all' })
    )
  })

  it('does not fail to render when there is no metrics row for this order', async () => {
    mount({ metrics: [] })
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    expect(screen.getByRole('button', { name: /Build the thing/ })).toBeTruthy()
  })
})

describe('FactoryHall', () => {
  it('addresses a station by its label, role, state and attempt', async () => {
    mount()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Build the thing, builder, Working, attempt 1' })
      ).toBeTruthy()
    )
  })

  it('leaves the station unbadged when nothing is waiting on the operator', async () => {
    mount()
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    const station = screen.getByRole('button', { name: /Build the thing/ })
    expect(station.querySelector('.fdry-hall-flag')).toBeNull()
  })

  it('flags a station whose session is stranded', async () => {
    mount({ view: view({ stranded: ['s-1'] }) })
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    const station = screen.getByRole('button', { name: /Build the thing/ })
    expect(station.querySelector('.fdry-hall-flag')).not.toBeNull()
  })

  it('flags a station holding a pending ask', async () => {
    mount({
      pending: [
        { requestId: 'r-1', sessionId: 's-1', toolName: 'Bash', summary: '', detail: null, at: 0 },
      ],
    })
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    const station = screen.getByRole('button', { name: /Build the thing/ })
    expect(station.querySelector('.fdry-hall-flag')).not.toBeNull()
  })

  it('shows the standing band only when it is the operator’s move', async () => {
    mount({
      view: view({
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
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    expect(screen.queryByText('Building')).toBeNull()
  })

  it('opens the inbox from the standing band when it is the operator’s move', async () => {
    const { onOpenInbox } = mount({
      view: view({
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
    await waitFor(() => screen.getByText('Halted — your move'))
    fireEvent.click(screen.getByRole('button', { name: 'Open Inbox' }))
    expect(onOpenInbox).toHaveBeenCalled()
  })

  it('sends a move with no gate behind it to the List view, never to an empty Inbox', async () => {
    const { onOpenInbox, onOpenInList } = mount({
      view: view({
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
    await waitFor(() => screen.getByText('Nothing is running this'))
    expect(screen.queryByRole('button', { name: 'Open Inbox' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open in List view' }))
    expect(onOpenInList).toHaveBeenCalled()
    expect(onOpenInbox).not.toHaveBeenCalled()
  })

  it('opens a station’s monitor and attaches to it', async () => {
    mount()
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    fireEvent.click(screen.getByRole('button', { name: /Build the thing/ }))
    await waitFor(() => screen.getByRole('button', { name: /ATTACH/ }))
    expect(document.querySelector('.fdry-hall-inspector')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /ATTACH/ }))
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

  it('shows the waiting station’s own card summary on its monitor', async () => {
    mount({
      view: view({
        waiting: [],
        stranded: ['s-1'],
      }),
    })
    fireEvent.click(await screen.findByRole('button', { name: /Build the thing/ }))
    await screen.findByRole('heading', { name: 'BUILD THE THING' })
    expect(screen.getByRole('img', { name: 'Needs you' })).toBeTruthy()
    expect(screen.getByText(/^WAITING FOR YOU: WAITING AT ITS TERMINAL/i)).toBeTruthy()
  })

  it('leaves the station name to the floor: no plate over it, the full label on the button', async () => {
    mount()
    const station = await screen.findByRole('button', { name: /Build the thing/ })
    expect(document.querySelector('.fdry-plate')).toBeNull()
    expect(station.getAttribute('aria-label')).toContain('Build the thing')
    expect(station.getAttribute('aria-label')).toContain('Working')
    expect(station.getAttribute('title')).toContain('Build the thing')
  })

  it('keeps the order bar above the hall rather than over its top row', async () => {
    mount()
    const back = await screen.findByRole('button', { name: /All halls/ })
    const frame = document.querySelector('.fdry-hall-frame') as HTMLElement
    expect(frame.contains(back)).toBe(false)
    expect(back.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('lifts callouts raised together clear of each other', async () => {
    // jsdom lays nothing out: give every box a size, and the hall one too.
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(400)
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(20)
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600)
    const two = (state: string) =>
      view({
        graph: {
          orderId: 'WO-1',
          recipe: 'standard',
          nodes: [node({ state }), node({ id: 'N-2', sessionId: 's-2', state })],
        },
        labels: { 'N-1': 'Build the thing', 'N-2': 'Build the other' },
      })
    let current = two('running')
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:run.observe') return current
      if (channel === 'foundry:permissions-list') return { pending: [] }
      if (channel === 'foundry:run.activity') return { activity: {} }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(
      <FactoryHall orderId="WO-1" onOpenInbox={vi.fn()} onOpenInList={vi.fn()} onBack={vi.fn()} />
    )
    await screen.findByRole('button', { name: /Build the other/ })
    current = two('passed')
    await waitFor(
      () => expect(document.querySelectorAll('.fdry-hall-overlay .fdry-callout')).toHaveLength(2),
      { timeout: 4000 }
    )
    const lifts = [...document.querySelectorAll<HTMLElement>('.fdry-callout')].map((c) =>
      c.style.getPropertyValue('--fdry-lift')
    )
    expect(new Set(lifts).size).toBe(2)
  })

  it('raises a callout at the station when its state changes, not a line under the picture', async () => {
    let current = view()
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:run.observe') return current
      if (channel === 'foundry:permissions-list') return { pending: [] }
      if (channel === 'foundry:run.activity') return { activity: {} }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(
      <FactoryHall orderId="WO-1" onOpenInbox={vi.fn()} onOpenInList={vi.fn()} onBack={vi.fn()} />
    )
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    current = view({
      graph: { orderId: 'WO-1', recipe: 'standard', nodes: [node({ state: 'passed' })] },
    })
    await waitFor(
      () => {
        const bubble = document.querySelector('.fdry-hall-overlay .fdry-callout') as HTMLElement
        expect(bubble.textContent).toBe('Done')
      },
      { timeout: 4000 }
    )
    expect(document.querySelector('.fdry-hall-ticker')).toBeNull()
  })

  it('pins a held tool call over its station and answers it there', async () => {
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
    fireEvent.click(within(card).getByRole('button', { name: 'Allow' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:permission-resolve', {
        requestId: 'r-1',
        decision: 'allow',
      })
    )
  })

  it("renders an agent's question on its card as markdown, and a command literally", async () => {
    mount({
      pending: [
        {
          requestId: 'r-1',
          sessionId: 's-1',
          toolName: 'AskUserQuestion',
          summary: 'Hide **done** tickets?',
          detail: null,
          at: 0,
        },
        {
          requestId: 'r-2',
          sessionId: 's-1',
          toolName: 'Bash',
          summary: 'rm **/*.tmp',
          detail: null,
          at: 0,
        },
      ],
    })
    const asked = await screen.findByRole('group', { name: 'Wants to run AskUserQuestion' })
    expect(within(asked).getByText('done').tagName).toBe('STRONG')
    const command = await screen.findByRole('group', { name: 'Wants to run Bash' })
    expect(command.textContent).toContain('rm **/*.tmp')
  })

  it('pins a waiting gate over the gate and decides it with the gate’s own options', async () => {
    mount({
      view: view({
        graph: {
          orderId: 'WO-1',
          recipe: 'standard',
          nodes: [
            node({ state: 'passed' }),
            node({
              id: 'G',
              kind: 'gate',
              role: 'foreman',
              state: 'ready',
              sessionId: null,
              dependsOn: ['N-1'],
            }),
          ],
        },
        waiting: [
          {
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
          },
        ],
      }),
    })
    const card = await screen.findByRole('group', { name: 'Merge the pull request?' })
    fireEvent.click(within(card).getByRole('button', { name: 'Approve' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'g-1',
        option: 'approve',
      })
    )
  })

  it('pins an agent parked at its terminal and takes you there', async () => {
    mount({ view: view({ stranded: ['s-1'] }) })
    const card = await screen.findByRole('group', { name: 'Waiting at its terminal' })
    fireEvent.click(within(card).getByRole('button', { name: 'Go to terminal' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-terminal', { sessionId: 's-1' })
    )
  })

  function replayable(frames: unknown[], ci?: unknown[]) {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:run.observe') return view()
      if (channel === 'foundry:permissions-list') return { pending: [] }
      if (channel === 'foundry:run.activity') return { activity: {} }
      if (channel === 'foundry:run.timeline')
        return {
          graph: view().graph,
          timeline: { frames, tools: [], ci },
          gates: [],
        }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(
      <FactoryHall orderId="WO-1" onOpenInbox={vi.fn()} onOpenInList={vi.fn()} onBack={vi.fn()} />
    )
  }

  const plateText = () =>
    screen.getByRole('button', { name: /Build the thing/ }).getAttribute('aria-label')

  it('replays the run from what was recorded, and scrubs to any moment of it', async () => {
    replayable([
      { at: 1000, nodes: [{ id: 'N-1', state: 'running', attempts: 1, sessionId: 's-1' }] },
      { at: 9000, nodes: [{ id: 'N-1', state: 'passed', attempts: 1, sessionId: 's-1' }] },
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Replay' }))
    const position = (await screen.findByRole('slider', {
      name: 'Replay position',
    })) as HTMLInputElement
    expect(invoke).toHaveBeenCalledWith('foundry:run.timeline', { id: 'WO-1' })
    expect(plateText()).toContain('Working')
    fireEvent.change(position, { target: { value: position.max } })
    await waitFor(() => expect(plateText()).toContain('Done'))
    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }))
    await waitFor(() =>
      expect(screen.queryByRole('slider', { name: 'Replay position' })).toBeNull()
    )
    expect(plateText()).toContain('Working')
  })

  it('replays the wait on CI, and the tower to wait at, from what was recorded', async () => {
    const pulls = (buckets: ('pass' | 'pending')[]) => [
      {
        url: 'https://github.com/a/b/pull/1',
        checks: buckets.map((bucket, i) => ({ name: `c${i}`, bucket, link: '', workflow: '' })),
      },
    ]
    replayable(
      [
        { at: 1000, nodes: [{ id: 'N-1', state: 'running', attempts: 1, sessionId: 's-1' }] },
        { at: 9000, nodes: [{ id: 'N-1', state: 'passed', attempts: 1, sessionId: 's-1' }] },
      ],
      [
        { at: 0, round: 0, max: 2, status: 'watching', pulls: pulls(['pass', 'pending']) },
        { at: 9000, round: 0, max: 2, status: 'green', pulls: pulls(['pass', 'pass']) },
      ]
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Replay' }))
    const position = (await screen.findByRole('slider', {
      name: 'Replay position',
    })) as HTMLInputElement
    await waitFor(() =>
      expect(document.querySelector('.fdry-callout[data-pinned="true"]')?.textContent).toBe(
        'Waiting on checks · 1 of 2 done'
      )
    )
    fireEvent.change(position, { target: { value: position.max } })
    await waitFor(() =>
      expect(document.querySelector('.fdry-callout[data-pinned="true"]')).toBeNull()
    )
  })

  it('plays, pauses and changes speed', async () => {
    replayable([
      { at: 1000, nodes: [{ id: 'N-1', state: 'running', attempts: 1, sessionId: 's-1' }] },
      { at: 3000, nodes: [{ id: 'N-1', state: 'passed', attempts: 1, sessionId: 's-1' }] },
    ])
    fireEvent.click(await screen.findByRole('button', { name: 'Replay' }))
    await screen.findByRole('button', { name: 'Pause' })
    fireEvent.click(screen.getByRole('button', { name: '4x' }))
    expect(screen.getByRole('button', { name: '4x' }).getAttribute('aria-pressed')).toBe('true')
    // 2 s of recording at 4x is half a second of replay
    await waitFor(() => expect(plateText()).toContain('Done'), { timeout: 2500 })
    await screen.findByRole('button', { name: 'Play' })
  })

  it('says so when nothing was recorded for this run', async () => {
    replayable([])
    fireEvent.click(await screen.findByRole('button', { name: 'Replay' }))
    await screen.findByText('Nothing recorded for this run yet.')
    expect(screen.queryByRole('slider', { name: 'Replay position' })).toBeNull()
  })

  it('goes back to the site', async () => {
    const { onBack } = mount()
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    fireEvent.click(screen.getByRole('button', { name: 'All halls' }))
    expect(onBack).toHaveBeenCalled()
  })

  it('says nothing to attach to when the failure comes back', async () => {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:run.observe') return view()
      if (channel === 'foundry:permissions-list') return { pending: [] }
      if (channel === 'foundry:run.activity') return { activity: {} }
      if (channel === 'foundry:run-transcript') return { lines: [] }
      if (channel === 'foundry:session.attach') return { error: 'gone' }
      return {}
    })
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    }
    render(<FactoryHall orderId="WO-1" onOpenInbox={vi.fn()} onBack={vi.fn()} />)
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    fireEvent.click(screen.getByRole('button', { name: /Build the thing/ }))
    await waitFor(() => screen.getByRole('button', { name: /ATTACH/ }))
    fireEvent.click(screen.getByRole('button', { name: /ATTACH/ }))
    await waitFor(() => screen.getByText('gone'))
  })
})

describe('an open station monitor is live', () => {
  const line = (text: string, at: number) => ({ role: 'assistant', kind: 'text', text, at })

  it('reads the transcript at once, then on the activity beat, and stops when closed', async () => {
    const lines = [line('first', 1)]
    mount({ lines })
    // The bridge hands back a fresh array on every read; the fake would not.
    const fake = invoke.getMockImplementation()!
    invoke.mockImplementation(async (channel: string, payload?: unknown) => {
      const r = (await fake(channel, payload)) as { lines?: unknown[] }
      return channel === 'foundry:run-transcript' ? { lines: [...(r.lines ?? [])] } : r
    })
    const station = await screen.findByRole('button', { name: /Build the thing/ })
    vi.useFakeTimers()
    try {
      fireEvent.click(station)
      await vi.advanceTimersByTimeAsync(0)

      const reads = () => invoke.mock.calls.filter((c) => c[0] === 'foundry:run-transcript')
      expect(reads().length).toBe(1)
      expect(reads()[0]![1]).toEqual({ sessionId: 's-1', limit: 40 })
      expect(screen.getByRole('log', { name: 'Transcript' }).textContent).toContain('first')

      lines.push(line('second', 2))
      await vi.advanceTimersByTimeAsync(2000)
      expect(reads().length).toBe(2)
      expect(screen.getByRole('log', { name: 'Transcript' }).textContent).toContain('second')

      fireEvent.click(screen.getByRole('button', { name: 'Close monitor' }))
      await vi.advanceTimersByTimeAsync(300)
      expect(screen.queryByRole('log', { name: 'Transcript' })).toBeNull()
      await vi.advanceTimersByTimeAsync(6000)
      expect(reads().length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not read a transcript for a station with no session', async () => {
    mount({
      view: view({
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [node({ sessionId: null })] },
      }),
    })
    fireEvent.click(await screen.findByRole('button', { name: /Build the thing/ }))
    await screen.findByRole('log', { name: 'Transcript' })
    expect(invoke.mock.calls.some((c) => c[0] === 'foundry:run-transcript')).toBe(false)
    expect(screen.getByRole('log', { name: 'Transcript' }).textContent?.trim()).toBe('NOTHING YET.')
  })
})

describe('FactoryHall labels what it draws', () => {
  const pull = (buckets: ('pass' | 'pending')[]) => ({
    url: 'https://github.com/a/b/pull/233',
    checks: buckets.map((bucket, i) => ({ name: `check-${i}`, bucket, link: '', workflow: 'CI' })),
  })
  const ci = (buckets: ('pass' | 'pending')[]) => ({
    round: 0,
    max: 2,
    status: 'watching',
    reason: '',
    at: '2026-10-05T10:00:00.000Z',
    pulls: [pull(buckets)],
  })
  const shipGraph = {
    orderId: 'WO-1',
    recipe: 'standard',
    nodes: [
      node({ id: 'N-1', state: 'passed', sessionId: 's-1' }),
      node({
        id: 'ship',
        kind: 'gate',
        state: 'running',
        role: null,
        sessionId: null,
        dependsOn: ['N-1'],
      }),
    ],
  }

  it("names the scoreboard with this order's real figures", async () => {
    mount({
      metrics: [{ orderId: 'WO-1', leadTimeMs: 25 * 60_000, reworks: 0, ciRounds: 0 }],
    })
    await waitFor(() =>
      expect(
        screen.getByRole('img', { name: 'Lead time 25 min · 0 reworks · 0 CI fix rounds' })
      ).toBeTruthy()
    )
  })

  it('keeps a callout pinned to the tower while checks are pending, and drops it when they land', async () => {
    const pending = [...Array(12).fill('pass'), ...Array(7).fill('pending')] as (
      | 'pass'
      | 'pending'
    )[]
    mount({
      view: view({ graph: shipGraph, labels: { 'N-1': 'Build', ship: 'Ship' }, ci: ci(pending) }),
    })
    await waitFor(() =>
      expect(document.querySelector('.fdry-callout[data-pinned="true"]')?.textContent).toBe(
        'Waiting on checks · 12 of 19 done'
      )
    )
    expect(screen.getByRole('img', { name: 'Waiting on checks · 12 of 19 done' })).toBeTruthy()
  })

  it('pins no wait when every check has landed', async () => {
    mount({
      view: view({
        graph: shipGraph,
        labels: { 'N-1': 'Build', ship: 'Ship' },
        ci: ci(['pass', 'pass']),
      }),
    })
    await waitFor(() => screen.getByRole('img', { name: 'Checks · 2 passed · 0 failed' }))
    expect(document.querySelector('.fdry-callout[data-pinned="true"]')).toBeNull()
  })

  it("opens the ship gate's monitor with what it decided and no attach key", async () => {
    mount({
      view: view({
        graph: shipGraph,
        labels: { 'N-1': 'Build', ship: 'Ship' },
        ci: ci(['pass', 'pending']),
        pulls: [{ repo: 'a/b', url: 'https://github.com/a/b/pull/233', number: 233, cwd: '/x' }],
      }),
    })
    fireEvent.click(await screen.findByRole('button', { name: /Ship/ }))
    const decided = await screen.findByRole('log', { name: 'What this step decided' })
    expect(decided.textContent).toBe('Draft opened · #233\nChecks · 1 of 2 passed')
    expect(screen.queryByRole('button', { name: /ATTACH/ })).toBeNull()
  })

  it("opens a finished agent's monitor with its transcript and attach disabled", async () => {
    mount({
      view: view({
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [node({ state: 'passed' })] },
      }),
      lines: [{ role: 'assistant', kind: 'text', text: 'All done.', at: 1 }],
    })
    fireEvent.click(await screen.findByRole('button', { name: /Build the thing/ }))
    await waitFor(() => screen.getByText('All done.'))
    expect(
      (screen.getByRole('button', { name: /Agent closed/i }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})

// A gate is one line with its answers on it, the reason a click away and written
// in markdown — the same card the list views draw, not a second rendering of it.
describe('FactoryHall gates and links', () => {
  const pullUrl = 'https://github.com/andytavares/terminator/pull/233'
  const ticketUrl = 'https://linear.app/team/issue/TAV-15'

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

  it('links the pull request and the ticket on the heads-up bar', async () => {
    mount({
      view: view({
        pulls: [{ repo: 'terminator', url: pullUrl, number: 233, cwd: '/wt' }],
        source: { key: 'TAV-15', url: ticketUrl },
      }),
    })
    const bar = await waitFor(() => {
      const found = document.querySelector('.fdry-hall-hud') as HTMLElement | null
      if (found === null) throw new Error('the heads-up bar is not drawn yet')
      return found
    })
    fireEvent.click(within(bar).getByRole('link', { name: '#233' }))
    fireEvent.click(within(bar).getByRole('link', { name: 'TAV-15' }))
    expect(openExternal).toHaveBeenCalledWith(pullUrl)
    expect(openExternal).toHaveBeenCalledWith(ticketUrl)
  })

  it('draws a waiting gate collapsed, with its answers on the line, and reads the reason as markdown', async () => {
    mount({ view: view({ waiting: [readyGate()] }) })
    expect(await screen.findByRole('button', { name: 'Mark ready' })).toBeTruthy()
    expect(document.querySelectorAll('.fdry-card li')).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: 'Show the reason' }))
    const items = document.querySelectorAll('.fdry-card li')
    expect([...items].map((li) => li.textContent)).toContain('the checks passed')
  })

  it('bounds an open gate card by the room between its station and the edge it grows toward', async () => {
    mount({ view: view({ waiting: [readyGate()] }) })
    await screen.findByRole('button', { name: 'Mark ready' })
    const card = document.querySelector('.fdry-card--gate') as HTMLElement
    const top = Number.parseFloat(card.style.top)
    const room = card.style.getPropertyValue('--fdry-card-room')
    if (card.classList.contains('is-below')) {
      expect(room).toBe(`calc(${100 - top}% - 26px)`)
    } else {
      expect(room).toBe(`calc(${top}% - 50px)`)
    }
  })

  it('lets a shipped order\u2019s open ready-for-review gate be answered in the hall', async () => {
    mount({
      view: view({
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [node({ state: 'passed' })] },
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
    fireEvent.click(await screen.findByRole('button', { name: 'Mark ready' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:inbox.decide', {
        gateId: 'G-1',
        option: 'mark_ready',
      })
    )
  })

  it('asks for a new limit on the card itself, rather than sending the operator to the Inbox', async () => {
    mount({
      view: view({
        waiting: [
          raiseGate({
            id: 'G-2',
            rule: 'budget.exceeded',
            orderId: 'WO-1',
            summary: 'Past its time budget',
            why: 'The order budgets 60 and is at 61.',
            at: '2026-09-06T10:00:00.000Z',
            breach: { kind: 'wall-clock', limit: 60, spent: 61 } as never,
          }),
        ],
      }),
    })
    await screen.findByText('Past its time budget')
    expect(screen.queryByRole('button', { name: 'Open Inbox' })).toBeNull()
    const raise = screen.getAllByRole('button').find((b) => /raise/i.test(b.textContent ?? ''))
    expect(raise).toBeTruthy()
  })
})
