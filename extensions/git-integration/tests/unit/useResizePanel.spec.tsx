import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useResizePanel } from '../../src/hooks/useResizePanel'
import { partialFake } from '../../../../tests/support/fakes'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useResizePanel', () => {
  it('initializes with the given size', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }))
    expect(result.current.size).toBe(300)
  })

  it('returns handleMouseDown function', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }))
    expect(typeof result.current.handleMouseDown).toBe('function')
  })

  it('handleMouseDown stores starting position and prevents default', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }))
    const preventDefault = vi.fn()
    act(() => {
      result.current.handleMouseDown(
        partialFake<React.MouseEvent>({
          clientX: 500,
          preventDefault,
        })
      )
    })
    expect(preventDefault).toHaveBeenCalled()
  })
})

describe('useResizePanel — onMove updates size when dragging (direction=1)', () => {
  it('onMove updates size when dragging (direction=1)', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }, 1))
    const preventDefault = vi.fn()

    // Start drag
    act(() => {
      result.current.handleMouseDown(
        partialFake<React.MouseEvent>({
          clientX: 500,
          preventDefault,
        })
      )
    })

    // Simulate mousemove event
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 550 }))
    })

    expect(result.current.size).toBe(350) // 300 + (550 - 500) * 1
  })
})

describe('useResizePanel — onMove updates size when dragging (direction=-1)', () => {
  it('onMove updates size when dragging (direction=-1)', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }, -1))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown(
        partialFake<React.MouseEvent>({
          clientX: 500,
          preventDefault,
        })
      )
    })

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 550 }))
    })

    // 300 + (550 - 500) * -1 = 300 - 50 = 250
    expect(result.current.size).toBe(250)
  })
})

describe('useResizePanel — onMove clamps size to minimum', () => {
  it('onMove clamps size to minimum', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 200, max: 600 }, 1))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown(
        partialFake<React.MouseEvent>({
          clientX: 500,
          preventDefault,
        })
      )
    })

    // Move left by 200px — would give 100, but min is 200
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 300 }))
    })

    expect(result.current.size).toBe(200)
  })
})

describe('useResizePanel — onMove clamps size to maximum', () => {
  it('onMove clamps size to maximum', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 400 }, 1))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown(
        partialFake<React.MouseEvent>({
          clientX: 500,
          preventDefault,
        })
      )
    })

    // Move right by 300px — would give 600, but max is 400
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 800 }))
    })

    expect(result.current.size).toBe(400)
  })
})

describe('useResizePanel — onMove does nothing when not dragging', () => {
  it('onMove does nothing when not dragging', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }, 1))

    // No handleMouseDown called — isDragging should be false
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 550 }))
    })

    // Size should remain unchanged
    expect(result.current.size).toBe(300)
  })
})

describe('useResizePanel — onUp stops dragging so subsequent moves have no effect', () => {
  it('onUp stops dragging so subsequent moves have no effect', () => {
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }, 1))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown(
        partialFake<React.MouseEvent>({
          clientX: 500,
          preventDefault,
        })
      )
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
})

describe('useResizePanel — cleans up event listeners on unmount', () => {
  it('cleans up event listeners on unmount', () => {
    const removeEventListener = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }))
    unmount()
    expect(removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function))
    expect(removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function))
  })

  it('uses direction=1 as default', () => {
    // direction defaults to 1 when not passed
    const { result } = renderHook(() => useResizePanel(300, { min: 100, max: 600 }))
    const preventDefault = vi.fn()

    act(() => {
      result.current.handleMouseDown(
        partialFake<React.MouseEvent>({
          clientX: 500,
          preventDefault,
        })
      )
    })

    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 560 }))
    })

    expect(result.current.size).toBe(360)
  })
})
