import { describe, it, expect, vi } from 'vitest'
import { endAndWait } from '../../src/runtime/end-session.js'

// A follow-up architect turn resumes the same conversation. Resuming it while
// the last turn's process still sits at its prompt puts two agents on one
// transcript, so the old one is ended first — and waited for, within bounds.

/** A session whose end the test fires by hand. */
function session(live = true) {
  const listeners = new Set<() => void>()
  return {
    stop: vi.fn(() => true),
    isLive: () => live,
    onEnd: vi.fn((_id: string, listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    }),
    end: () => listeners.forEach((listener) => listener()),
    listeners,
  }
}

describe('endAndWait', () => {
  it('stops the session and resolves when its end is announced', async () => {
    const s = session()
    const gone = endAndWait(s, { sessionId: 'sid', reason: 'reason' })
    expect(s.stop).toHaveBeenCalledWith('sid', 'reason')
    s.end()
    await expect(gone).resolves.toBe(true)
    expect(s.listeners.size).toBe(0)
  })

  it('does nothing for a session that is already gone', async () => {
    const s = session(false)
    await expect(endAndWait(s, { sessionId: 'sid', reason: 'r' })).resolves.toBe(true)
    expect(s.stop).not.toHaveBeenCalled()
    expect(s.onEnd).not.toHaveBeenCalled()
  })

  it('gives up after the timeout and says so, rather than waiting for ever', async () => {
    vi.useFakeTimers()
    try {
      const s = session()
      const gone = endAndWait(s, { sessionId: 'sid', reason: 'r' }, { timeoutMs: 1000 })
      await vi.advanceTimersByTimeAsync(1000)
      await expect(gone).resolves.toBe(false)
      expect(s.listeners.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
