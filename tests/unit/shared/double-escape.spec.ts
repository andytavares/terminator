import { describe, it, expect } from 'vitest'
import {
  createDoubleEscapeDetector,
  DOUBLE_ESCAPE_WINDOW_MS,
  shouldSuppressExitGesture,
  type EscapeContext,
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

// ── The guards (036) ────────────────────────────────────────────────────────
//
// The host window's detector stood down inside a terminal, inside a text field,
// and while a modal was open. The copy running inside every extension had none
// of those guards, so Escape twice in a text field closed the extension and
// discarded the draft. One decision function now serves both, because two
// implementations of one rule is exactly how they came to disagree.

describe('shouldSuppressExitGesture', () => {
  const ctx = (over: Partial<EscapeContext> = {}): EscapeContext => ({
    inTerminal: false,
    inTextField: false,
    modalDepth: 0,
    ...over,
  })

  it('does not suppress when nothing has claimed the key', () => {
    expect(shouldSuppressExitGesture(ctx())).toBe(false)
  })

  it('suppresses inside a terminal, where Escape belongs to the shell', () => {
    expect(shouldSuppressExitGesture(ctx({ inTerminal: true }))).toBe(true)
  })

  // This is the case that lost people's work.
  it('suppresses inside a text field, where Escape belongs to the field', () => {
    expect(shouldSuppressExitGesture(ctx({ inTextField: true }))).toBe(true)
  })

  it('suppresses while a modal surface is open', () => {
    expect(shouldSuppressExitGesture(ctx({ modalDepth: 1 }))).toBe(true)
  })

  it('suppresses while nested modal surfaces are open', () => {
    expect(shouldSuppressExitGesture(ctx({ modalDepth: 3 }))).toBe(true)
  })

  it('stops suppressing once the last surface closes', () => {
    expect(shouldSuppressExitGesture(ctx({ modalDepth: 0 }))).toBe(false)
  })

  it('suppresses when several conditions hold at once', () => {
    expect(shouldSuppressExitGesture(ctx({ inTerminal: true, inTextField: true }))).toBe(true)
  })

  it('treats a negative depth as nothing open rather than as a suppressor', () => {
    expect(shouldSuppressExitGesture(ctx({ modalDepth: -1 }))).toBe(false)
  })
})
