import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResizePanel } from '../../src/hooks/useResizePanel'

describe('useResizePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with the given size', () => {
    const { result } = renderHook(() => useResizePanel(300, 100, 600))
    expect(result.current.size).toBe(300)
  })

  it('returns handleMouseDown function', () => {
    const { result } = renderHook(() => useResizePanel(300, 100, 600))
    expect(typeof result.current.handleMouseDown).toBe('function')
  })

  it('handleMouseDown stores starting position and prevents default', () => {
    const { result } = renderHook(() => useResizePanel(300, 100, 600))
    const preventDefault = vi.fn()
    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault } as unknown as React.MouseEvent)
    })
    expect(preventDefault).toHaveBeenCalled()
  })

  it('onMove updates size when dragging (direction=1)', () => {
    const { result } = renderHook(() => useResizePanel(300, 100, 600, 1))
    const preventDefault = vi.fn()

    // Start drag
    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault } as unknown as React.MouseEvent)
    })

    // Simulate mousemove event
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 550 }))
    })

    expect(result.current.size).toBe(350) // 300 + (550 - 500) * 1
  })

  it('onMove updates size when dragging (direction=-1)', () => {
    const { result } = renderHook(() => useResizePanel(300, 100, 600, -1))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault } as unknown as React.MouseEvent)
    })

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 550 }))
    })

    // 300 + (550 - 500) * -1 = 300 - 50 = 250
    expect(result.current.size).toBe(250)
  })

  it('onMove clamps size to minimum', () => {
    const { result } = renderHook(() => useResizePanel(300, 200, 600, 1))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault } as unknown as React.MouseEvent)
    })

    // Move left by 200px — would give 100, but min is 200
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })

    expect(result.current.size).toBe(200)
  })

  it('onMove clamps size to maximum', () => {
    const { result } = renderHook(() => useResizePanel(300, 100, 400, 1))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault } as unknown as React.MouseEvent)
    })

    // Move right by 300px — would give 600, but max is 400
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 }))
    })

    expect(result.current.size).toBe(400)
  })

  it('onMove does nothing when not dragging', () => {
    const { result } = renderHook(() => useResizePanel(300, 100, 600, 1))

    // No handleMouseDown called — isDragging should be false
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 550 }))
    })

    // Size should remain unchanged
    expect(result.current.size).toBe(300)
  })

  it('onUp stops dragging so subsequent moves have no effect', () => {
    const { result } = renderHook(() => useResizePanel(300, 100, 600, 1))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault } as unknown as React.MouseEvent)
    })

    // Move to change size
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 550 }))
    })
    expect(result.current.size).toBe(350)

    // Mouse up stops dragging
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })

    // Further moves should have no effect
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 }))
    })
    expect(result.current.size).toBe(350)
  })

  it('cleans up event listeners on unmount', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useResizePanel(300, 100, 600))
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function))
  })

  it('uses direction=1 as default', () => {
    // direction defaults to 1 when not passed
    const { result } = renderHook(() => useResizePanel(300, 100, 600))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown({ clientX: 500, preventDefault } as unknown as React.MouseEvent)
    })

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 560 }))
    })

    expect(result.current.size).toBe(360)
  })
})
