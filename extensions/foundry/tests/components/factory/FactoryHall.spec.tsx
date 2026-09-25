import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
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
