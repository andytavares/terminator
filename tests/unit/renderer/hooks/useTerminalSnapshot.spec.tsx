import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../../../src/renderer/stores/session.store', () => ({
  useSessionStore: vi.fn(),
}))

import { useSessionStore } from '../../../../src/renderer/stores/session.store'
import { useTerminalSnapshot } from '../../../../src/renderer/hooks/useTerminalSnapshot'

describe('useTerminalSnapshot', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function mockStore(getTerminalInstance: (id: string) => unknown): void {
    // The hook uses selector form: useSessionStore((s) => s.getTerminalInstance)
    vi.mocked(useSessionStore).mockImplementation((selector?: unknown) => {
      const state = { getTerminalInstance }
      return typeof selector === 'function' ? selector(state) : state
    })
  }

  it('returns null when no terminal instance exists', () => {
    mockStore(() => undefined)
    const { result } = renderHook(() => useTerminalSnapshot('sess-1'))
    expect(result.current).toBeNull()
  })

  it('returns null when captureToDataUrl returns null and no lastSnapshot', () => {
    mockStore(() => ({
      captureToDataUrl: () => null,
      lastSnapshot: null,
    }))
    const { result } = renderHook(() => useTerminalSnapshot('sess-1'))
    expect(result.current).toBeNull()
  })

  it('returns data URL from captureToDataUrl when live capture succeeds', () => {
    mockStore(() => ({
      captureToDataUrl: () => 'data:image/jpeg;base64,live',
      lastSnapshot: null,
    }))
    const { result } = renderHook(() => useTerminalSnapshot('sess-1'))
    expect(result.current).toBe('data:image/jpeg;base64,live')
  })

  it('falls back to lastSnapshot when live capture returns null', () => {
    mockStore(() => ({
      captureToDataUrl: () => null,
      lastSnapshot: 'data:image/jpeg;base64,stored',
    }))
    const { result } = renderHook(() => useTerminalSnapshot('sess-1'))
    expect(result.current).toBe('data:image/jpeg;base64,stored')
  })
})
