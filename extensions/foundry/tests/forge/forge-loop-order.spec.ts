/**
 * The ledger line that says an architect turn started is on the record before
 * anything that turn's end writes. The loop decides its next move from the
 * ledger, so a start written late reads as a turn still running after its
 * redraft, and is missing from the count of follow-ups.
 *
 * Deterministic: the architect's turn ends before `convergeOnce` even
 * answers, every ledger write but a start lands in a microtask, and a start
 * lands only when the fake clock reaches it — the slow write, made certain.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import type { ArchitectTurn } from '../../src/forge/intake-turn.js'
import { eventually } from '../../../../tests/support/eventually'

const ledger = vi.hoisted(() => ({
  entries: [] as { action: string }[],
  turnEnds: [] as Promise<void>[],
}))

const STARTS = new Set(['converge.started', 'converge.followed_up'])
const SLOW_WRITE_MS = 50

/** A write that lands when the fake clock reaches it. */
function landsLater(): Promise<void> {
  let land: () => void = () => undefined
  const landed = new Promise<void>((resolve) => (land = resolve))
  setTimeout(land, SLOW_WRITE_MS)
  return landed
}

vi.mock('../../src/state/live-index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/state/live-index.js')>()
  const recordEntry = async (entry: { action: string }): Promise<void> => {
    if (STARTS.has(entry.action)) await landsLater()
    ledger.entries.push(entry)
  }
  return {
    ...actual,
    orderStoreAt: () => ({
      record: recordEntry,
      entries: async () => [...ledger.entries] as never[],
    }),
  }
})

// Every turn ends at once, refused, before its start is even answered.
vi.mock('../../src/forge/intake-turn.js', () => {
  let turn = 0
  return {
    convergeOnce: vi.fn(async (_api: unknown, architect: ArchitectTurn) => {
      turn += 1
      ledger.turnEnds.push(
        architect.onFinished({ ok: false, reason: 'acceptance: Expected array' })
      )
      return { ok: true, sessionId: `architect-${turn}` }
    }),
    readOnlyRound: vi.fn(),
  }
})

const { createForgeLoop } = await import('../../src/forge/forge-loop.js')
const { createDeciding } = await import('../../src/ipc/standing.js')

const showToast = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  ledger.entries = []
  ledger.turnEnds = []
  showToast.mockClear()
})

afterEach(() => vi.useRealTimers())

function loop() {
  const api = { notifications: { showToast } } as never
  return createForgeLoop(
    { api, dataRoot: () => '/records' },
    { deciding: createDeciding(), channels: () => ({}) as never }
  )
}

const order = { id: 'WO-1', title: 'Make it red' } as never

describe('a turn that ends before its start is written', () => {
  it('has each follow-up on the ledger before the refusal it ended in', async () => {
    const running = loop().convergeWithFollowUps({
      order,
      message: 'draft it',
      autoTurns: 0,
    })
    await eventually(() =>
      expect(showToast).toHaveBeenCalledWith(
        'warning',
        "Make it red: the architect's plan was refused and nothing changed.",
        'foundry.converge.refused.WO-1'
      )
    )

    await running
    await Promise.all(ledger.turnEnds)

    expect(ledger.entries.map((e) => e.action)).toEqual([
      'converge.refused',
      'converge.followed_up',
      'converge.refused',
      'converge.followed_up',
      'converge.refused',
    ])
  })
})
