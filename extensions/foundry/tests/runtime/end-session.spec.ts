import { describe, it, expect, vi } from 'vitest'
import { endAndWait } from '../../src/runtime/end-session.js'

// A follow-up architect turn resumes the same conversation. Resuming it while
// the last turn's process still sits at its prompt puts two agents on one
// transcript, so the old one is ended first — and waited for, within bounds.

const noSleep = () => Promise.resolve()

describe('endAndWait', () => {
  describe('stopping', stoppingTests)
  describe('the timeout', theTimeoutTests)
  describe('the real clock', theRealClockTests)
})

function stoppingTests() {
  it('stops the session and resolves once it is gone', async () => {
    let checks = 0
    const stop = vi.fn(() => true)
    const gone = await endAndWait(
      { stop, isLive: () => ++checks < 3, sleep: noSleep },
      { sessionId: 'sid', reason: 'reason' }
    )
    expect(stop).toHaveBeenCalledWith('sid', 'reason')
    expect(gone).toBe(true)
  })

  it('does nothing for a session that is already gone', async () => {
    const stop = vi.fn(() => true)
    await expect(
      endAndWait({ stop, isLive: () => false, sleep: noSleep }, { sessionId: 'sid', reason: 'r' })
    ).resolves.toBe(true)
    expect(stop).not.toHaveBeenCalled()
  })
}

function theTimeoutTests() {
  it('gives up after the timeout and says so, rather than waiting for ever', async () => {
    let waited = 0
    const gone = await endAndWait(
      {
        stop: () => true,
        isLive: () => true,
        sleep: (ms) => {
          waited += ms
          return Promise.resolve()
        },
      },
      { sessionId: 'sid', reason: 'r' },
      { timeoutMs: 1000, intervalMs: 250 }
    )
    expect(gone).toBe(false)
    expect(waited).toBe(1000)
  })
}

function theRealClockTests() {
  it('waits on the real clock when no sleep is given', async () => {
    let live = true
    setTimeout(() => (live = false), 5)
    const gone = await endAndWait(
      { stop: () => true, isLive: () => live },
      { sessionId: 'sid', reason: 'r' },
      {
        timeoutMs: 1000,
        intervalMs: 2,
      }
    )
    expect(gone).toBe(true)
  })
}
