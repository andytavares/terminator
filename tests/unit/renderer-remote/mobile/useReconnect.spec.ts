import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { partialFake } from '../../../support/fakes'

// Must be jsdom for document.addEventListener
const mockOpenWs = vi.fn()

/** The hooks every "useReconnect" describe registers. */
function setUpUseReconnect(): void {
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
}

describe('useReconnect', () => {
  setUpUseReconnect()

  it('returns status "connected" when ws is open', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 1 } as WebSocket
    const { result } = renderHook(() => useReconnect(mockOpenWs, ws))
    expect(result.current.status).toBe('connected')
  })

  it('becomes connected when an already-open socket replaces null', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const { result, rerender } = renderHook(({ ws }) => useReconnect(mockOpenWs, ws), {
      initialProps: { ws: null as WebSocket | null },
    })
    expect(result.current.status).toBe('connecting')
    rerender({ ws: { readyState: 1 } as WebSocket })
    expect(result.current.status).toBe('connected')
  })

  it('returns status "connecting" when ws is null (not yet opened)', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const { result } = renderHook(() => useReconnect(mockOpenWs, null))
    expect(result.current.status).toBe('connecting')
  })
})

describe('useReconnect — calls openWs when page becomes visible and ws is closed', () => {
  setUpUseReconnect()

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
})

describe('useReconnect — sets status to "reconnecting" after first reconnect attempt', () => {
  setUpUseReconnect()

  it('sets status to "reconnecting" after first reconnect attempt', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = { readyState: 3 } as WebSocket
    const { result } = renderHook(() => useReconnect(mockOpenWs, ws))

    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(result.current.status).toBe('reconnecting')
  })
})

describe('useReconnect — sets status to "disconnected" after 3 failed attempts', () => {
  setUpUseReconnect()

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
})

describe('useReconnect — does not call openWs again while socket is still CONNECTING but counts the attempt', () => {
  setUpUseReconnect()

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
})

describe('useReconnect — onOpenWsFailed enters the reconnect loop when initial openWs throws', () => {
  setUpUseReconnect()

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
})

describe('useReconnect — onOpenWsFailed sets disconnected after 3 failures', () => {
  setUpUseReconnect()

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
})

// A socket is an EventTarget with a ready state; the hook needs nothing else.
function socket(readyState: WebSocket['readyState']) {
  const events = new EventTarget()
  return partialFake<WebSocket>({
    readyState,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
      events.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
      events.removeEventListener(type, listener),
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
  })
}

describe('useReconnect — clears reconnecting status when new ws fires onopen', () => {
  setUpUseReconnect()

  it('clears reconnecting status when new ws fires onopen', async () => {
    const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
    const ws = socket(3) // CLOSED

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
    const openWs2 = socket(0) // CONNECTING

    rerender({ currentWs: openWs2 })

    // Fire onopen — status should clear
    act(() => {
      openWs2.dispatchEvent(new Event('open'))
    })

    expect(result.current.status).toBe('connected')
  })
})

describe('useReconnect — retry() resets attempt count and starts reconnect', () => {
  setUpUseReconnect()

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

/** An EventTarget with a ready state: all the hook reads of a socket. */
function eventSocket(readyState: WebSocket['readyState']): WebSocket {
  const events = new EventTarget()
  return partialFake<WebSocket>({
    readyState,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
      events.addEventListener(type, listener),
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
      events.removeEventListener(type, listener),
    dispatchEvent: (event: Event) => events.dispatchEvent(event),
  })
}

/** The server closes the socket with `code`; the hook says `status` and stays there. */
async function closedOnPurpose(code: number, status: string): Promise<void> {
  const { useReconnect } = await import('../../../../src/renderer-remote/hooks/useReconnect')
  const ws = eventSocket(1)
  const { result } = renderHook(() => useReconnect(mockOpenWs, ws))
  act(() => {
    ws.dispatchEvent(new CloseEvent('close', { code }))
  })
  expect(result.current.status).toBe(status)
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await act(async () => {
    vi.advanceTimersByTime(6000)
  })
  expect(mockOpenWs).not.toHaveBeenCalled()
  expect(result.current.status).toBe(status)
}

describe('useReconnect — a socket the server closes on purpose', () => {
  setUpUseReconnect()

  it.each([
    [4003, 'full'],
    [4004, 'removed'],
  ])('says why on close code %i, and does not come back by itself', closedOnPurpose)
})
