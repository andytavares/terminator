import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

// Must be jsdom for document.addEventListener
describe('useReconnect', () => {
  const mockOpenWs = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns status "connected" when ws is open', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 1 } as WebSocket
    const { result } = renderHook(() => useReconnect(mockOpenWs, ws))
    expect(result.current.status).toBe('connected')
  })

  it('returns status "connecting" when ws is null (not yet opened)', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const { result } = renderHook(() => useReconnect(mockOpenWs, null))
    expect(result.current.status).toBe('connecting')
  })

  it('calls openWs when page becomes visible and ws is closed', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 3 } as WebSocket // CLOSED
    renderHook(() => useReconnect(mockOpenWs, ws))

    // Simulate page becoming visible
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockOpenWs).toHaveBeenCalledTimes(1)
  })

  it('does not call openWs if ws is still open when page becomes visible', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 1 } as WebSocket // OPEN
    renderHook(() => useReconnect(mockOpenWs, ws))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(mockOpenWs).not.toHaveBeenCalled()
  })

  it('sets status to "reconnecting" after first reconnect attempt', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 3 } as WebSocket
    const { result } = renderHook(() => useReconnect(mockOpenWs, ws))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.status).toBe('reconnecting')
  })

  it('sets status to "disconnected" after 3 failed attempts', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 3 } as WebSocket
    const { result } = renderHook(() => useReconnect(mockOpenWs, ws))

    // Trigger first attempt
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.status).toBe('reconnecting')

    // Advance past 2s delay for 2nd attempt
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    // 3rd attempt after another 2s
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    // After 3 attempts, status should be disconnected
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.status).toBe('disconnected')
  })

  it('does not call openWs again while socket is still CONNECTING but counts the attempt', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 0 } as WebSocket // CONNECTING
    const { result } = renderHook(() => useReconnect(mockOpenWs, ws))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.status).toBe('reconnecting')
    // Advance past all 3 attempt delays — should reach disconnected without calling openWs
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(mockOpenWs).not.toHaveBeenCalled()
    expect(result.current.status).toBe('disconnected')
  })

  it('onOpenWsFailed enters the reconnect loop when initial openWs throws', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const { result } = renderHook(() => useReconnect(mockOpenWs, null))
    expect(result.current.status).toBe('connecting')

    act(() => {
      result.current.onOpenWsFailed()
    })

    expect(result.current.status).toBe('reconnecting')
    // After 2s, attempt() fires and calls openWs again
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(mockOpenWs).toHaveBeenCalled()
  })

  it('onOpenWsFailed sets disconnected after 3 failures', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const { result } = renderHook(() => useReconnect(mockOpenWs, null))

    act(() => {
      result.current.onOpenWsFailed()
    }) // attempt 1
    act(() => {
      result.current.onOpenWsFailed()
    }) // attempt 2
    act(() => {
      result.current.onOpenWsFailed()
    }) // attempt 3 — schedules final timer
    // Timer fires, attempt() sees count >= 3 → disconnected
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })

    expect(result.current.status).toBe('disconnected')
  })

  it('clears reconnecting status when new ws fires onopen', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const listeners: Record<string, (() => void)[]> = {}
    const ws = {
      readyState: 3, // starts CLOSED
      addEventListener: (ev: string, fn: () => void) => {
        listeners[ev] = listeners[ev] ?? []
        listeners[ev].push(fn)
      },
      removeEventListener: (_ev: string, _fn: () => void) => undefined,
    } as unknown as WebSocket

    const { result, rerender } = renderHook(
      ({ currentWs }) => useReconnect(mockOpenWs, currentWs),
      { initialProps: { currentWs: ws } }
    )

    // Trigger reconnect
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.status).toBe('reconnecting')

    // Simulate new socket passed in after openWs called
    const openWs2 = {
      readyState: 0, // CONNECTING
      addEventListener: (ev: string, fn: () => void) => {
        listeners[ev] = listeners[ev] ?? []
        listeners[ev].push(fn)
      },
      removeEventListener: (_ev: string, _fn: () => void) => undefined,
    } as unknown as WebSocket

    rerender({ currentWs: openWs2 })

    // Fire onopen — status should clear
    act(() => {
      listeners['open']?.forEach((fn) => fn())
    })

    expect(result.current.status).toBe('connected')
  })

  it('retry() resets attempt count and starts reconnect', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 3 } as WebSocket
    const { result } = renderHook(() => useReconnect(mockOpenWs, ws))

    // Exhaust attempts
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      vi.advanceTimersByTime(6000)
    })
    expect(result.current.status).toBe('disconnected')

    act(() => {
      result.current.retry()
    })

    expect(result.current.status).toBe('reconnecting')
    expect(mockOpenWs).toHaveBeenCalled()
  })
})
