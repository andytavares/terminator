import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { FactoryHall } from '../../../src/components/factory/FactoryHall.js'

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

function mount(
  props: {
    view?: Record<string, unknown>
    pending?: unknown[]
    activity?: Record<string, unknown>
    lines?: unknown[]
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
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
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

describe('FactoryHall', () => {
  it('addresses a station by its label, role, state and attempt', async () => {
    mount()
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Build the thing, builder, running, attempt 1' })
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

  it('opens a station’s inspector and attaches to it', async () => {
    mount()
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    fireEvent.click(screen.getByRole('button', { name: /Build the thing/ }))
    await waitFor(() => screen.getByRole('button', { name: /Attach/ }))
    fireEvent.click(screen.getByRole('button', { name: /Attach/ }))
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

  it('shows each station its own nameplate, in the hall, saying where it stands', async () => {
    mount()
    await waitFor(() => screen.getByRole('button', { name: /Build the thing/ }))
    const plate = document.querySelector('.fdry-hall-overlay .fdry-plate') as HTMLElement
    expect(plate.textContent).toContain('Build the thing')
    expect(plate.textContent).toContain('Working')
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

  function replayable(frames: unknown[]) {
    invoke = vi.fn(async (channel: string) => {
      if (channel === 'foundry:run.observe') return view()
      if (channel === 'foundry:permissions-list') return { pending: [] }
      if (channel === 'foundry:run.activity') return { activity: {} }
      if (channel === 'foundry:run.timeline')
        return {
          graph: view().graph,
          timeline: { frames, tools: [] },
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
    (document.querySelector('.fdry-hall-overlay .fdry-plate') as HTMLElement).textContent

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
    await waitFor(() => screen.getByRole('button', { name: /Attach/ }))
    fireEvent.click(screen.getByRole('button', { name: /Attach/ }))
    await waitFor(() => screen.getByText('gone'))
  })
})
