import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { isRelevant, useFoundryQuery } from '../../src/renderer/foundry-query.js'
import type { FoundryChange } from '../../src/state/foundry-index.js'
import { settlePushedReads } from '../helpers/fake-time.js'

let pushChange: (change: FoundryChange) => void
let switchWorkspace: () => void
let unsubscribe: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  unsubscribe = vi.fn()
  const changed: ((data: unknown) => void)[] = []
  const switched: ((data: unknown) => void)[] = []
  pushChange = (change) => changed.forEach((handler) => handler(change))
  switchWorkspace = () => switched.forEach((handler) => handler({}))
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      extensionBridge: {
        on: vi.fn((channel: string, handler: (data: unknown) => void) => {
          if (channel === 'foundry:changed') changed.push(handler)
          if (channel === 'workspace:changed') switched.push(handler)
          return unsubscribe
        }),
      },
    },
  })
})

afterEach(() => vi.useRealTimers())

describe('useFoundryQuery', () => {
  describe('reading on mount and on change', readingTests)
  describe('filtering and bursts', filteringTests)
  describe('a read in flight', inFlightTests)
  describe('a failure', failureTests)
  describe('after unmount', afterUnmountTests)
  describe('two views of one query', sharedTests)
})

function readingTests() {
  it('reads once on mount and returns the answer', async () => {
    const read = vi.fn(async () => 'first')
    const { result } = renderHook(() => useFoundryQuery({ key: ['a'], kinds: ['order'] }, read))
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(1)
    expect(result.current.data).toBe('first')
  })

  it('reads again for a change of a kind it draws, and not for another kind', async () => {
    const read = vi.fn(async () => 1)
    renderHook(() => useFoundryQuery({ key: ['a'], kinds: ['order'] }, read))
    await settlePushedReads()
    pushChange({ kind: 'ledger', orderId: 'WO-1' })
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(1)
    pushChange({ kind: 'order', orderId: 'WO-1' })
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reads again when the workspace switches', async () => {
    const read = vi.fn(async () => 1)
    renderHook(() => useFoundryQuery({ key: ['a'], kinds: ['order'] }, read))
    await settlePushedReads()
    switchWorkspace()
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(2)
  })
}

function filteringTests() {
  it('ignores a change to another order when it draws one order', async () => {
    const read = vi.fn(async () => 1)
    renderHook(() =>
      useFoundryQuery({ key: ['a', 'WO-1'], kinds: ['graph'], orderId: 'WO-1' }, read)
    )
    await settlePushedReads()
    pushChange({ kind: 'graph', orderId: 'WO-2' })
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(1)
    pushChange({ kind: 'graph', orderId: 'WO-1' })
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('reads once for a burst of changes', async () => {
    const read = vi.fn(async () => 1)
    renderHook(() => useFoundryQuery({ key: ['a'], kinds: ['graph'] }, read))
    await settlePushedReads()
    for (let i = 0; i < 5; i++) pushChange({ kind: 'graph', orderId: 'WO-1' })
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(2)
  })
}

function inFlightTests() {
  it('shows the newest answer when a change lands while a read is in flight', async () => {
    let arrive: (value: number) => void = () => {}
    const read = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(() => new Promise((resolve) => (arrive = resolve)))
      .mockResolvedValue(2)
    const { result } = renderHook(() => useFoundryQuery({ key: ['a'], kinds: ['graph'] }, read))
    pushChange({ kind: 'graph', orderId: 'WO-1' })
    await settlePushedReads()
    arrive(1)
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(2)
    expect(result.current.data).toBe(2)
  })
}

function failureTests() {
  it('surfaces a throwing read as an error and raises no unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const read = vi.fn(async (): Promise<number> => {
      throw new Error('channel down')
    })
    const { result } = renderHook(() => useFoundryQuery({ key: ['a'], kinds: ['graph'] }, read))
    await settlePushedReads()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10)
    })
    process.off('unhandledRejection', unhandled)
    expect(result.current.error?.message).toBe('channel down')
    expect(unhandled).not.toHaveBeenCalled()
  })
}

function afterUnmountTests() {
  it('stops reading once unmounted', async () => {
    const read = vi.fn(async () => 1)
    const { unmount } = renderHook(() => useFoundryQuery({ key: ['a'], kinds: ['graph'] }, read))
    await settlePushedReads()
    unmount()
    pushChange({ kind: 'graph', orderId: 'WO-1' })
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('stops listening once the last view is gone', async () => {
    const read = vi.fn(async () => 1)
    const { unmount } = renderHook(() => useFoundryQuery({ key: ['a'], kinds: ['graph'] }, read))
    unmount()
    await settlePushedReads()
    expect(unsubscribe).toHaveBeenCalledTimes(2)
  })
}

function sharedTests() {
  it('makes one read per change for two views of the same key', async () => {
    const read = vi.fn(async () => 1)
    const useTwoViews = () => [
      useFoundryQuery({ key: ['signals'], kinds: ['signals'] }, read),
      useFoundryQuery({ key: ['signals'], kinds: ['signals'] }, read),
    ]
    renderHook(useTwoViews)
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(1)
    pushChange({ kind: 'signals', orderId: '' })
    await settlePushedReads()
    expect(read).toHaveBeenCalledTimes(2)
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
