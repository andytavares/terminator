import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { FactoryHall } from '../../../src/components/factory/FactoryHall.js'
import { hallNode, hallView } from '../../helpers/hall-views.js'

// The hall's moves FactoryHall.spec.tsx leaves out: replaying, denying a held call, a
// parked agent with no terminal, and a monitor on an idle or failed station.

const FRAMES = [
  { at: 1000, nodes: [{ id: 'N-1', state: 'running', attempts: 1, sessionId: 's-1' }] },
  { at: 3000, nodes: [{ id: 'N-1', state: 'passed', attempts: 1, sessionId: 's-1' }] },
]

const HELD = { requestId: 'r-1', sessionId: 's-1', toolName: 'Bash', summary: 'npm test' }

let invoke = vi.fn()

/** The hall over `shown`, with `answers` overriding what a channel says. */
function mountHall(shown: unknown, answers: Record<string, () => unknown> = {}): void {
  const replies: Record<string, () => unknown> = {
    'foundry:run.observe': () => shown,
    'foundry:permissions-list': () => ({ pending: [] }),
    'foundry:run.activity': () => ({ activity: {} }),
    'foundry:run-transcript': () => ({ lines: [] }),
    'foundry:run.timeline': () => ({
      graph: hallView().graph,
      timeline: { frames: FRAMES, tools: [] },
      gates: [],
    }),
    ...answers,
  }
  invoke = vi.fn(async (channel: string) => (channel in replies ? replies[channel]() : {}))
  Object.defineProperty(window, 'electronAPI', {
    value: { extensionBridge: { invoke, on: vi.fn(() => vi.fn()) } },
    configurable: true,
    writable: true,
  })
  render(<FactoryHall orderId="WO-1" onOpenInList={vi.fn()} onBack={vi.fn()} />)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('playing a replay', () => {
  it('pauses where it is, and plays again from the start once it has ended', async () => {
    mountHall(hallView())
    // The replay's clock stands still: on a real one every step redraws the
    // hall, and every query waiting for a button reads the whole hall again.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      fireEvent.click(await screen.findByRole('button', { name: 'Replay' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Pause' }))
      await screen.findByRole('button', { name: 'Play' })
      const position = (await screen.findByRole('slider', {
        name: 'Replay position',
      })) as HTMLInputElement
      fireEvent.change(position, { target: { value: position.max } })
      await waitFor(() => expect(position.value).toBe(position.max))
      expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Play' }))
      await screen.findByRole('button', { name: 'Pause' })
      expect(Number(position.value)).toBeLessThan(Number(position.max))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a held call on its card', () => {
  it('is denied there', async () => {
    mountHall(hallView(), {
      'foundry:permissions-list': () => ({ pending: [HELD] }),
      'foundry:permission-resolve': () => ({ ok: true }),
    })
    const card = await screen.findByRole('group', { name: 'Wants to run Bash' })
    fireEvent.click(within(card).getByRole('button', { name: 'Deny' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('foundry:permission-resolve', {
        requestId: 'r-1',
        decision: 'deny',
      })
    )
  })

  it('says why an answer did not land, on the card it came from', async () => {
    mountHall(hallView(), {
      'foundry:permissions-list': () => ({ pending: [HELD] }),
      'foundry:permission-resolve': () => ({ ok: false }),
    })
    const card = await screen.findByRole('group', { name: 'Wants to run Bash' })
    fireEvent.click(within(card).getByRole('button', { name: 'Allow' }))
    expect(await within(card).findByText('That request is no longer waiting.')).toBeTruthy()
  })
})

describe('a parked agent with no terminal left', () => {
  it('says so on its card', async () => {
    mountHall(hallView({ stranded: ['s-1'] }), { 'foundry:run-terminal': () => ({ ok: false }) })
    const card = await screen.findByRole('group', { name: 'Waiting at its terminal' })
    fireEvent.click(within(card).getByRole('button', { name: 'Go to terminal' }))
    expect(await within(card).findByText('That agent is no longer in a terminal.')).toBeTruthy()
  })
})

describe('what an open monitor says of its station', () => {
  it('says no agent for a station nothing is running', async () => {
    mountHall(hallView({ orphaned: ['N-1'] }))
    fireEvent.click(await screen.findByRole('button', { name: /Build the thing/ }))
    expect(await screen.findByRole('img', { name: 'No agent' })).toBeTruthy()
  })

  it('says a failed station failed, with the run’s own headline', async () => {
    mountHall(
      hallView({
        graph: { orderId: 'WO-1', recipe: 'standard', nodes: [hallNode({ state: 'failed' })] },
        standing: {
          kind: 'stopped',
          turn: 'you',
          label: 'stopped',
          headline: 'The build failed twice',
          detail: '',
          done: 0,
          total: 1,
          gateId: null,
        },
      })
    )
    fireEvent.click(await screen.findByRole('button', { name: /Build the thing/ }))
    await screen.findByRole('img', { name: 'Failed' })
    expect(screen.getByText('FAILED: THE BUILD FAILED TWICE')).toBeTruthy()
  })
})
