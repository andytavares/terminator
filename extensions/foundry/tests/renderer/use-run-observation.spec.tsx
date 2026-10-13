import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRunObservation } from '../../src/renderer/use-run-observation.js'
import { createChangeBus } from '../helpers/change-bus.js'

// The pushed half of the Floor: fetch the run's observation and the pending
// asks against it on mount and again when Foundry says they changed, without
// the rest of the Floor's own state (review, feed, stalls, transcript) along
// for the ride.

const NODES = [
  {
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
  },
]

function reply(over: Record<string, unknown> = {}) {
  return {
    graph: { orderId: 'WO-1', recipe: 'standard', nodes: NODES },
    ready: ['N-1'],
    blocked: [],
    ...over,
  }
}

const ASK = {
  requestId: 'r-1',
  sessionId: 's-1',
  toolName: 'Write',
  summary: 'Write src/auth/session.ts',
  detail: null,
  at: 1,
}

let invoke: ReturnType<typeof vi.fn>
let bus: ReturnType<typeof createChangeBus>

function mockBridge(observe: unknown, pending: unknown[] = []) {
  bus = createChangeBus()
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') return observe
    if (channel === 'foundry:permissions-list') return { pending }
    return {}
  })
  Object.assign(window, {
    electronAPI: {
      extensionBridge: { invoke, on: bus.on },
    },
  })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

const observed = () => invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe').length
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(200)))

describe('useRunObservation', () => {
  describe('reading', readingTests)
  describe('live changes', liveChangesTests)
  describe('errors and unmount', errorsAndUnmountTests)
  describe('a new order id', aNewOrderIdTests)
})

function readingTests() {
  it('reads the observation and the pending asks on mount', async () => {
    mockBridge(reply(), [ASK])
    const { result } = renderHook(() => useRunObservation('WO-1'))

    await waitFor(() => expect(result.current.view).not.toBeNull())
    expect(result.current.view?.graph.orderId).toBe('WO-1')
    expect(result.current.pending).toEqual([ASK])
    expect(invoke).toHaveBeenCalledWith('foundry:run.observe', { id: 'WO-1' })
    expect(invoke).toHaveBeenCalledWith('foundry:permissions-list', {})
  })

  it('reads the observation again when a record of this order changes', async () => {
    mockBridge(reply())
    renderHook(() => useRunObservation('WO-1'))
    await waitFor(() => expect(observed()).toBe(1))

    for (const kind of ['order', 'graph', 'gates', 'ledger'] as const) {
      const before = observed()
      bus.emit({ kind, orderId: 'WO-1' })
      await settle()
      expect(observed(), kind).toBe(before + 1)
    }
  })
}

function liveChangesTests() {
  const asked = () => invoke.mock.calls.filter((c) => c[0] === 'foundry:permissions-list').length

  it('does not read again for another order, nor for time passing', async () => {
    mockBridge(reply())
    renderHook(() => useRunObservation('WO-1'))
    await waitFor(() => expect(observed()).toBe(1))

    bus.emit({ kind: 'graph', orderId: 'WO-2' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(observed()).toBe(1)
    expect(asked()).toBe(1)
  })

  it('reads the pending asks again on a live change, whichever order it names', async () => {
    mockBridge(reply())
    renderHook(() => useRunObservation('WO-1'))
    await waitFor(() => expect(asked()).toBe(1))

    bus.emit({ kind: 'live', orderId: '' })
    await settle()
    expect(asked()).toBe(2)
  })
}

function errorsAndUnmountTests() {
  it('keeps the last view and sets a problem when the observe call errors', async () => {
    mockBridge(reply())
    const { result, rerender } = renderHook(() => useRunObservation('WO-1'))
    await waitFor(() => expect(result.current.view).not.toBeNull())
    const lastView = result.current.view

    mockBridge({ error: 'No run for WO-1.' })
    await act(async () => {
      await result.current.refresh()
    })
    rerender()

    expect(result.current.problem).toBe('No run for WO-1.')
    expect(result.current.view).toBe(lastView)
  })

  it('stops reading once unmounted', async () => {
    mockBridge(reply())
    const { unmount } = renderHook(() => useRunObservation('WO-1'))
    await waitFor(() =>
      expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe')).toHaveLength(1)
    )
    unmount()
    const before = observed()
    bus.emit({ kind: 'graph', orderId: 'WO-1' })
    await settle()
    expect(observed()).toBe(before)
  })
}

function aNewOrderIdTests() {
  it('refetches when the order id changes', async () => {
    mockBridge(reply())
    const { result, rerender } = renderHook(({ id }: { id: string }) => useRunObservation(id), {
      initialProps: { id: 'WO-1' },
    })
    await waitFor(() => expect(result.current.view).not.toBeNull())

    mockBridge(reply({ graph: { orderId: 'WO-2', recipe: 'standard', nodes: [] } }))
    rerender({ id: 'WO-2' })

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('foundry:run.observe', { id: 'WO-2' }))
    await waitFor(() => expect(result.current.view?.graph.orderId).toBe('WO-2'))
  })
}
