import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNow } from '../../../../src/renderer/components/session/useNow'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts at the current time', () => {
    const { result } = renderHook(() => useNow())
    expect(result.current).toBe(Date.parse('2026-01-01T00:00:00Z'))
  })

  it('advances after the refresh interval so relative ages stay true', () => {
    const { result } = renderHook(() => useNow(1000))
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current).toBe(Date.parse('2026-01-01T00:00:01Z'))
  })

  it('stops refreshing once unmounted', () => {
    const { unmount } = renderHook(() => useNow(1000))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
