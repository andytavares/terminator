import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useRunObservation } from '../../src/renderer/use-run-observation.js'

// The polling half of the Floor: fetch the run's observation and the pending
// asks against it, on mount and on an interval, without the rest of the
// Floor's own state (review, feed, stalls, transcript) along for the ride.

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

function mockBridge(observe: unknown, pending: unknown[] = []) {
  invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') return observe
    if (channel === 'foundry:permissions-list') return { pending }
    return {}
  })
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useRunObservation', () => {
  it('polls the observation and the pending asks on mount', async () => {
    mockBridge(reply(), [ASK])
    const { result } = renderHook(() => useRunObservation('WO-1'))

    await waitFor(() => expect(result.current.view).not.toBeNull())
    expect(result.current.view?.graph.orderId).toBe('WO-1')
    expect(result.current.pending).toEqual([ASK])
    expect(invoke).toHaveBeenCalledWith('foundry:run.observe', { id: 'WO-1' })
    expect(invoke).toHaveBeenCalledWith('foundry:permissions-list', {})
  })

  it('polls again on the live interval', async () => {
    mockBridge(reply())
    renderHook(() => useRunObservation('WO-1'))

    await waitFor(() =>
      expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe')).toHaveLength(1)
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100)
    })
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe').length).toBeGreaterThan(
      1
    )
  })

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

  it('stops polling once unmounted', async () => {
    mockBridge(reply())
    const { unmount } = renderHook(() => useRunObservation('WO-1'))
    await waitFor(() =>
      expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe')).toHaveLength(1)
    )
    unmount()
    const before = invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe').length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(invoke.mock.calls.filter((c) => c[0] === 'foundry:run.observe').length).toBe(before)
  })

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
})
