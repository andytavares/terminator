import { describe, it, expect } from 'vitest'
import {
  createDoubleEscapeDetector,
  DOUBLE_ESCAPE_WINDOW_MS,
} from '../../../src/shared/double-escape'

describe('createDoubleEscapeDetector', () => {
  it('does not trigger on a single Escape', () => {
    const detector = createDoubleEscapeDetector()
    expect(detector.register(1000)).toBe(false)
  })

  it('triggers on a second Escape inside the window', () => {
    const detector = createDoubleEscapeDetector()
    detector.register(1000)
    expect(detector.register(1000 + DOUBLE_ESCAPE_WINDOW_MS - 1)).toBe(true)
  })

  it('does not trigger when the second Escape falls outside the window', () => {
    const detector = createDoubleEscapeDetector()
    detector.register(1000)
    expect(detector.register(1000 + DOUBLE_ESCAPE_WINDOW_MS)).toBe(false)
  })

  it('requires a fresh pair after triggering, so a third press does not re-trigger', () => {
    const detector = createDoubleEscapeDetector()
    detector.register(1000)
    expect(detector.register(1100)).toBe(true)
    expect(detector.register(1200)).toBe(false)
    expect(detector.register(1300)).toBe(true)
  })

  it('restarts the pairing when a press falls outside the window', () => {
    const detector = createDoubleEscapeDetector()
    detector.register(1000)
    expect(detector.register(5000)).toBe(false)
    expect(detector.register(5100)).toBe(true)
  })

  it('honours a caller-supplied window', () => {
    const detector = createDoubleEscapeDetector(100)
    detector.register(0)
    expect(detector.register(150)).toBe(false)
    detector.register(1000)
    expect(detector.register(1050)).toBe(true)
  })

  it('forgets the pending press when reset', () => {
    const detector = createDoubleEscapeDetector()
    detector.register(1000)
    detector.reset()
    expect(detector.register(1100)).toBe(false)
  })
})
