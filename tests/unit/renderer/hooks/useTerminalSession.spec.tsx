import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const { mockCreate, mockSplit } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockSplit: vi.fn(),
}))
vi.mock('../../../../src/renderer/terminal/session-controller', () => ({
  createTerminalSession: mockCreate,
  splitTerminalSession: mockSplit,
}))

import { useTerminalSession } from '../../../../src/renderer/hooks/useTerminalSession'

// The composition behavior (instance wiring, bell/busy routing, split pinning)
// is tested in tests/unit/renderer/terminal/session-controller.spec.ts — this
// hook is a thin, referentially-stable binding over the controller.
describe('useTerminalSession', () => {
  it('exposes the controller functions', () => {
    const { result } = renderHook(() => useTerminalSession())
    expect(result.current.createSession).toBe(mockCreate)
    expect(result.current.splitSession).toBe(mockSplit)
  })

  it('returns referentially stable functions across re-renders', () => {
    const { result, rerender } = renderHook(() => useTerminalSession())
    const first = result.current
    rerender()
    expect(result.current.createSession).toBe(first.createSession)
    expect(result.current.splitSession).toBe(first.splitSession)
  })
})
