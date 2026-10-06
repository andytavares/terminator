import { describe, it, expect, vi } from 'vitest'
import {
  convergeMaybeScouted,
  withScoutContext,
  waitForScout,
  SCOUT_WAIT_MS,
} from '../../src/forge/scouted-converge.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

// The first draft starts at once; the scout reads the repository beside it.
// Two writers to one draft is how a scout's findings and the architect's plan
// overwrite each other, so the architect never waits for the scout and never
// takes its output into the first draft — `withScoutContext` keeps the
// scout's findings on the order when the architect's save lands after them.

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Hide done tickets in the picker',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, ...over }
}

function amendedOrder(): WorkOrder {
  return order({
    provenance: { forgeSession: null, decisions: ['accepted a finding'], amendments: [] },
    context: { ...order().context, entryPoints: ['src/index.ts'] },
  })
}

describe('convergeMaybeScouted', () => {
  it('starts the architect with the order as given while the scout is still running', async () => {
    const startScout = vi.fn() // never finishes
    const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'architect-1' })

    const result = await convergeMaybeScouted({ startScout, startArchitect }, order(), 'draft it')

    expect(result).toEqual({ ok: true, sessionId: 'architect-1' })
    expect(startScout).toHaveBeenCalledWith(order())
    expect(startArchitect).toHaveBeenCalledWith(order(), 'draft it')
  })

  it('answers with the architect result even when the scout throws', async () => {
    const startScout = vi.fn().mockImplementation(() => {
      throw new Error('no claude binary')
    })
    const startArchitect = vi.fn().mockResolvedValue({ ok: false, reason: 'refused' })

    const result = await convergeMaybeScouted({ startScout, startArchitect }, order(), 'draft it')

    expect(result).toEqual({ ok: false, reason: 'refused' })
    expect(startArchitect).toHaveBeenCalledTimes(1)
  })

  it('skips the scout for an amending draft', async () => {
    const startScout = vi.fn()
    const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'architect-1' })

    const result = await convergeMaybeScouted(
      { startScout, startArchitect },
      amendedOrder(),
      'amend it'
    )

    expect(result).toEqual({ ok: true, sessionId: 'architect-1' })
    expect(startScout).not.toHaveBeenCalled()
    expect(startArchitect).toHaveBeenCalledWith(amendedOrder(), 'amend it')
  })
})

describe('withScoutContext', () => {
  const scouted = order({
    context: {
      ...order().context,
      entryPoints: ['src/foo.ts'],
      priorArt: ['abc123 hid done tickets'],
      conventions: ['kebab-case files'],
    },
  })

  it('carries the scout findings onto a draft saved without them', () => {
    const drafted = order({ title: 'The architect title' })
    const merged = withScoutContext(drafted, scouted)
    expect(merged.title).toBe('The architect title')
    expect(merged.context.entryPoints).toEqual(['src/foo.ts'])
    expect(merged.context.priorArt).toEqual(['abc123 hid done tickets'])
    expect(merged.context.conventions).toEqual(['kebab-case files'])
  })

  it('keeps what the architect wrote and adds only what is missing', () => {
    const drafted = order({
      context: { ...order().context, entryPoints: ['src/foo.ts', 'src/bar.ts'] },
    })
    const merged = withScoutContext(drafted, scouted)
    expect(merged.context.entryPoints).toEqual(['src/foo.ts', 'src/bar.ts'])
  })

  it('returns the draft untouched when nothing is stored or the scout found nothing', () => {
    const drafted = order()
    expect(withScoutContext(drafted, null)).toBe(drafted)
    expect(withScoutContext(drafted, order())).toBe(drafted)
  })
})

describe('waitForScout', () => {
  it('returns at once when no scout is running for the order', async () => {
    await expect(waitForScout('WO-none')).resolves.toBe('none')
  })

  it('waits for a running scout to finish, then returns', async () => {
    let finish: () => void = () => undefined
    const startScout = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'a' })
    await convergeMaybeScouted({ startScout, startArchitect }, order({ id: 'WO-w' }), 'draft')

    let settled: string | null = null
    const waiting = waitForScout('WO-w').then((r) => (settled = r))
    await Promise.resolve()
    expect(settled).toBeNull()

    finish()
    await waiting
    expect(settled).toBe('finished')
    await expect(waitForScout('WO-w')).resolves.toBe('none')
  })

  it('gives up after the time box and lets the red team start with what is stored', async () => {
    vi.useFakeTimers()
    try {
      const startScout = vi.fn(() => new Promise<void>(() => undefined)) // never ends
      const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'a' })
      await convergeMaybeScouted({ startScout, startArchitect }, order({ id: 'WO-t' }), 'draft')

      const waiting = waitForScout('WO-t')
      await vi.advanceTimersByTimeAsync(SCOUT_WAIT_MS)
      await expect(waiting).resolves.toBe('timed_out')
    } finally {
      vi.useRealTimers()
    }
  })

  it('treats a scout that rejects as finished, not as an error', async () => {
    const startScout = vi.fn(() => Promise.reject(new Error('crashed')))
    const startArchitect = vi.fn().mockResolvedValue({ ok: true, sessionId: 'a' })
    await convergeMaybeScouted({ startScout, startArchitect }, order({ id: 'WO-x' }), 'draft')
    await expect(waitForScout('WO-x')).resolves.toMatch(/^(finished|none)$/)
  })
})
