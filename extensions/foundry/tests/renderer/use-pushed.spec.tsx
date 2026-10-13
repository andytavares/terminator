import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePushed, isRelevant } from '../../src/renderer/use-pushed.js'
import type { FoundryChange } from '../../src/state/foundry-index.js'

let emit: (change: FoundryChange) => void
let unsubscribe: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  unsubscribe = vi.fn()
  const handlers: ((data: unknown) => void)[] = []
  emit = (change) => handlers.forEach((handler) => handler(change))
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      extensionBridge: {
        on: vi.fn((channel: string, handler: (data: unknown) => void) => {
          if (channel === 'foundry:changed') handlers.push(handler)
          return unsubscribe
        }),
      },
    },
  })
})

afterEach(() => vi.useRealTimers())

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200)
  })
}

describe('usePushed', () => {
  describe('reading on mount and on change', readingOnMountAndOnChangeTests)
  describe('filtering and bursts', filteringAndBurstsTests)
  describe('a read in flight', aReadInFlightTests)
  describe('after unmount', afterUnmountTests)
})

function readingOnMountAndOnChangeTests() {
  it('reads once on mount and shows the answer', async () => {
    const read = vi.fn(async () => 'first')
    const show = vi.fn()
    renderHook(() => usePushed(read, show, { kinds: ['order'] }))
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith('first')
  })

  it('reads again for a change of a kind it draws, and not for another kind', async () => {
    const read = vi.fn(async () => 1)
    renderHook(() => usePushed(read, vi.fn(), { kinds: ['order'] }))
    await settle()
    emit({ kind: 'ledger', orderId: 'WO-1' })
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    emit({ kind: 'order', orderId: 'WO-1' })
    await settle()
    expect(read).toHaveBeenCalledTimes(2)
  })
}

function filteringAndBurstsTests() {
  it('ignores a change to another order when it draws one order', async () => {
    const read = vi.fn(async () => 1)
    renderHook(() => usePushed(read, vi.fn(), { kinds: ['graph'], orderId: 'WO-1' }))
    await settle()
    emit({ kind: 'graph', orderId: 'WO-2' })
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    emit({ kind: 'graph', orderId: 'WO-1' })
    await settle()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reads once for a burst of changes', async () => {
    const read = vi.fn(async () => 1)
    renderHook(() => usePushed(read, vi.fn(), { kinds: ['graph'] }))
    await settle()
    for (let i = 0; i < 5; i++) emit({ kind: 'graph', orderId: 'WO-1' })
    await settle()
    expect(read).toHaveBeenCalledTimes(2)
  })
}

function aReadInFlightTests() {
  it('reads again when a change lands while a read is still in flight', async () => {
    let arrive: (value: number) => void = () => {}
    const read = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(() => new Promise((resolve) => (arrive = resolve)))
      .mockResolvedValue(2)
    const show = vi.fn()
    renderHook(() => usePushed(read, show, { kinds: ['graph'] }))
    emit({ kind: 'graph', orderId: 'WO-1' })
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    arrive(1)
    await settle()
    expect(read).toHaveBeenCalledTimes(2)
    expect(show).toHaveBeenLastCalledWith(2)
  })
}

function afterUnmountTests() {
  it('stops listening and reading once unmounted', async () => {
    const read = vi.fn(async () => 1)
    const { unmount } = renderHook(() => usePushed(read, vi.fn(), { kinds: ['graph'] }))
    await settle()
    emit({ kind: 'graph', orderId: 'WO-1' })
    unmount()
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('does not show an answer that arrives after unmount', async () => {
    let arrive: (value: number) => void = () => {}
    const read = vi.fn(() => new Promise<number>((resolve) => (arrive = resolve)))
    const show = vi.fn()
    const { unmount } = renderHook(() => usePushed(read, show, { kinds: ['graph'] }))
    unmount()
    arrive(7)
    await settle()
    expect(show).not.toHaveBeenCalled()
  })
}

describe('isRelevant', () => {
  it('treats a change tied to no order as concerning every order', () => {
    expect(isRelevant({ kind: 'live', orderId: '' }, { kinds: ['live'], orderId: 'WO-1' })).toBe(
      true
    )
  })

  it('draws nothing when no kind is asked for', () => {
    expect(isRelevant({ kind: 'order', orderId: 'WO-1' }, { kinds: [] })).toBe(false)
  })
})
