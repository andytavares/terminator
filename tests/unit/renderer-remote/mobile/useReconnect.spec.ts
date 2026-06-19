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

  it('returns status "connected" when ws is null (not yet opened)', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const { result } = renderHook(() => useReconnect(mockOpenWs, null))
    expect(result.current.status).toBe('connected')
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
