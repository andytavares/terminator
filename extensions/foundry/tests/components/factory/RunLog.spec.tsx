import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { FactoryHall } from '../../../src/components/factory/FactoryHall.js'
import { hallView } from '../../helpers/hall-views.js'

// The whiteboard on the hall wall opens the log of every station.

const LOG_LINES = [
  {
    at: Date.UTC(2026, 9, 12, 10, 0, 1),
    station: 'Build the thing',
    role: 'builder',
    kind: 'say',
    text: 'reading tokens',
  },
  {
    at: Date.UTC(2026, 9, 12, 10, 0, 2),
    station: 'operator',
    role: null,
    kind: 'decision',
    text: 'approve · looks right',
  },
  {
    at: Date.UTC(2026, 9, 12, 10, 0, 3),
    station: 'commands',
    role: null,
    kind: 'command',
    text: 'lint.log · 2026-10-12',
    logPath: '/runs/lint.log',
  },
]

function mountHall(lines: unknown[]): void {
  const replies: Record<string, () => unknown> = {
    'foundry:run.observe': () => hallView(),
    'foundry:permissions-list': () => ({ pending: [] }),
    'foundry:run.activity': () => ({ activity: {} }),
    'foundry:run-transcript': () => ({ lines: [] }),
    'foundry:factory.metrics': () => ({ orders: [] }),
    'foundry:run-log': () => ({ lines }),
  }
  const invoke = vi.fn(async (channel: string) => (channel in replies ? replies[channel]() : {}))
  Object.assign(window, {
    electronAPI: {
      usage: { record: vi.fn() },
      extensionBridge: { invoke, on: vi.fn(() => vi.fn()) },
    },
  })
  render(<FactoryHall orderId="WO-1" onOpenInList={vi.fn()} onBack={vi.fn()} />)
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function openTheLog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Run log: every station' }))
  return screen.findByRole('region', { name: 'Run log' })
}

describe('the run log', () => {
  describe('opening and closing', openingTests)
  describe('reading', readingTests)
})

function openingTests() {
  it('opens from the whiteboard with a line from each source, and Escape closes it', async () => {
    mountHall(LOG_LINES)
    const log = await openTheLog()
    expect(await within(log).findByText('reading tokens')).toBeTruthy()
    expect(within(log).getByText('approve · looks right')).toBeTruthy()
    expect(within(log).getByText('lint.log · 2026-10-12')).toBeTruthy()
    expect(document.activeElement).toBe(log)
    fireEvent.keyDown(log, { key: 'Escape' })
    expect(screen.queryByRole('region', { name: 'Run log' })).toBeNull()
  })
}

function readingTests() {
  it('filters to one kind of line', async () => {
    mountHall(LOG_LINES)
    const log = await openTheLog()
    await within(log).findByText('reading tokens')
    fireEvent.click(within(log).getByRole('button', { name: 'Decisions' }))
    expect(within(log).queryByText('reading tokens')).toBeNull()
    expect(within(log).getByText('approve · looks right')).toBeTruthy()
  })

  it('folds a long command log behind "Show all N lines"', async () => {
    const body = Array.from({ length: 30 }, (_, n) => ({
      at: 1,
      station: 'commands',
      role: null,
      kind: 'command',
      text: `row ${n}`,
      logPath: '/runs/a.log',
    }))
    mountHall(body)
    const log = await openTheLog()
    await within(log).findByText('row 0')
    expect(within(log).queryByText('row 25')).toBeNull()
    fireEvent.click(within(log).getByRole('button', { name: 'Show all 30 lines' }))
    expect(within(log).getByText('row 25')).toBeTruthy()
  })
}
