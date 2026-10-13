import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { Floor } from '../../src/components/Floor.js'

// The bridge calls an idle open Floor makes in a minute, per channel. Run this file on its
// own (`npx vitest run <this file>`) to see the counts printed.

const RUNNING_NODE = {
  id: 'N-1',
  unitIds: ['U-1'],
  lane: 1,
  role: 'builder',
  kind: 'agent',
  state: 'running',
  sessionId: 's-1',
  attempts: 1,
  reworks: 0,
  feedback: [],
  startedAt: null,
  endedAt: null,
  dependsOn: [],
  stepId: 'build',
  worktreePath: null,
}

function mountOpenFloor(): ReturnType<typeof vi.fn> {
  const invoke = vi.fn(async (channel: string) => {
    if (channel === 'foundry:run.observe') {
      return {
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [RUNNING_NODE] },
        ready: [],
        blocked: [],
      }
    }
    if (channel === 'foundry:permissions-list') return { pending: [] }
    if (channel === 'foundry:stalls-list') return { firings: [], shadowMode: true }
    if (channel === 'foundry:feed-list') return { entries: [], mutes: [] }
    if (channel === 'foundry:run-transcript') return { lines: [] }
    return {}
  })
  Object.assign(window, {
    electronAPI: {
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
      shell: { openExternal: vi.fn() },
      extension: { runCommand: vi.fn(), hasCommand: vi.fn(async () => false) },
    },
  })
  render(<Floor orderId="WO-1" />)
  return invoke
}

function perChannel(invoke: ReturnType<typeof vi.fn>): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const [channel] of invoke.mock.calls as [string][]) {
    counts[channel] = (counts[channel] ?? 0) + 1
  }
  return counts
}

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
})

describe('an open Floor with nothing happening', () => {
  it('reads its state once and asks again only for what the agents are saying', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const invoke = mountOpenFloor()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-transcript', expect.anything())
    )
    invoke.mockClear()

    await vi.advanceTimersByTimeAsync(60_000)

    const counts = perChannel(invoke)
    console.info(`Floor, one minute: ${invoke.mock.calls.length} calls`, counts)
    expect(Object.keys(counts)).toEqual(['foundry:run-transcript'])
  })

  it('asks for nothing at all while hidden', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const invoke = mountOpenFloor()
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:run-transcript', expect.anything())
    )
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    invoke.mockClear()

    await vi.advanceTimersByTimeAsync(60_000)

    expect(invoke).not.toHaveBeenCalled()
  })
})
