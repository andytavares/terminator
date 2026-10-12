import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePolled } from '../../src/renderer/use-polled.js'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  setHidden(false)
})

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('usePolled', () => {
  it('reads at once, then every interval, and shows each answer', async () => {
    let count = 0
    const read = vi.fn(async () => ++count)
    const show = vi.fn()
    renderHook(() => usePolled(read, show, 1000))

    await act(async () => {})
    expect(show.mock.calls).toEqual([[1]])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(show.mock.calls).toEqual([[1], [2], [3]])
  })

  it('stops reading once unmounted', async () => {
    const read = vi.fn(async () => 1)
    const { unmount } = renderHook(() => usePolled(read, vi.fn(), 1000))
    await act(async () => {})
    unmount()
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(1)
  })

  it('does not show an answer that arrives after unmount', async () => {
    let arrive: (value: number) => void = () => {}
    const read = vi.fn(() => new Promise<number>((resolve) => (arrive = resolve)))
    const show = vi.fn()
    const { unmount } = renderHook(() => usePolled(read, show, 1000))
    unmount()
    arrive(7)
    await act(async () => {})
    expect(show).not.toHaveBeenCalled()
  })

  it('stops while the view is hidden and reads at once when it is shown again', async () => {
    const read = vi.fn(async () => 1)
    renderHook(() => usePolled(read, vi.fn(), 1000))
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(1)

    act(() => setHidden(true))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(read).toHaveBeenCalledTimes(1)

    act(() => setHidden(false))
    await act(async () => {})
    expect(read).toHaveBeenCalledTimes(2)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('does not start polling when mounted while hidden', async () => {
    setHidden(true)
    const read = vi.fn(async () => 1)
    renderHook(() => usePolled(read, vi.fn(), 1000))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(read).toHaveBeenCalledTimes(1)
  })
})
