import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { HallThumbnail } from '../../../src/components/factory/HallThumbnail.js'
import type { RunGraph } from '../../../src/line/run-graph.js'

// The Factory's front door shows a picture, not just text — one still frame
// of the order's own hall, fetched once it is actually on screen.

const GRAPH: RunGraph = {
  orderId: 'WO-1',
  recipe: 'r',
  nodes: [
    {
      id: 'n-1',
      stepId: 'build',
      kind: 'agent',
      state: 'running',
      unitIds: [],
      lane: null,
      role: 'builder',
      dependsOn: [],
      attempts: 0,
      reworks: 0,
      feedback: [],
      sessionId: null,
      worktreePath: null,
      startedAt: null,
      endedAt: null,
    },
  ],
}

/** A controllable stand-in for `IntersectionObserver`: `fire` triggers every
 *  observer's callback as if its element just became visible. */
function stubIntersectionObserver() {
  const instances: { callback: IntersectionObserverCallback }[] = []
  class FakeIO {
    callback: IntersectionObserverCallback
    constructor(cb: IntersectionObserverCallback) {
      this.callback = cb
      instances.push(this)
    }
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  vi.stubGlobal('IntersectionObserver', FakeIO as unknown as typeof IntersectionObserver)
  return {
    fire: () => {
      for (const inst of instances) {
        inst.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver
        )
      }
    },
  }
}

function mockBridge(invoke: ReturnType<typeof vi.fn>) {
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
  }
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () =>
      ({
        fillStyle: '#000',
        globalCompositeOperation: 'source-over',
        fillRect: vi.fn(),
        drawImage: vi.fn(),
        createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      }) as unknown as RenderingContext
  )
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('components/factory/HallThumbnail', () => {
  it('renders a picture region labelled for the order once its graph arrives', async () => {
    const invoke = vi.fn(async () => ({ graph: GRAPH }))
    mockBridge(invoke)
    render(<HallThumbnail orderId="WO-1" title="Build the thing" refreshKey="running" />)
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Factory floor for Build the thing' })).toBeTruthy()
    )
  })

  it('shows a plain placeholder for a draft with no run yet, never an empty box', async () => {
    const invoke = vi.fn(async () => ({}))
    mockBridge(invoke)
    render(<HallThumbnail orderId="WO-2" title="Not yet started" refreshKey="draft" />)
    await waitFor(() =>
      expect(
        screen.getByText('Not started yet — the floor appears when the work starts.')
      ).toBeTruthy()
    )
  })

  it('fetches the graph only once per order', async () => {
    const invoke = vi.fn(async () => ({ graph: GRAPH }))
    mockBridge(invoke)
    const { rerender } = render(
      <HallThumbnail orderId="WO-1" title="Build the thing" refreshKey="running" />
    )
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    rerender(<HallThumbnail orderId="WO-1" title="Build the thing" refreshKey="running" />)
    await waitFor(() => expect(screen.getByRole('img')).toBeTruthy())
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('refetches when the order standing changes', async () => {
    const invoke = vi.fn(async () => ({ graph: GRAPH }))
    mockBridge(invoke)
    const { rerender } = render(
      <HallThumbnail orderId="WO-1" title="Build the thing" refreshKey="running" />
    )
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
    rerender(<HallThumbnail orderId="WO-1" title="Build the thing" refreshKey="halted" />)
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2))
  })

  it('fetches nothing until the card is actually visible', async () => {
    const io = stubIntersectionObserver()
    const invoke = vi.fn(async () => ({ graph: GRAPH }))
    mockBridge(invoke)
    render(<HallThumbnail orderId="WO-1" title="Build the thing" refreshKey="running" />)
    expect(invoke).not.toHaveBeenCalled()
    io.fire()
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
  })

  it('fetches right away when IntersectionObserver is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const invoke = vi.fn(async () => ({ graph: GRAPH }))
    mockBridge(invoke)
    render(<HallThumbnail orderId="WO-1" title="Build the thing" refreshKey="running" />)
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
  })
})
