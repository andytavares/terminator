import { describe, it, expect, vi, beforeEach } from 'vitest'
import { subscribeToSessionOutput } from '../../../../src/renderer/terminal/output-router'

type OutputHandler = (sessionId: string, data: string) => void

let deliver: OutputHandler
const removeListener = vi.fn()
const onOutput = vi.fn((handler: OutputHandler) => {
  deliver = handler
  return removeListener
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { electronAPI: { terminal: { onOutput } } })
})

describe('subscribeToSessionOutput', () => {
  it('hands output to the subscriber of that session only', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = subscribeToSessionOutput('a', first)
    const stopSecond = subscribeToSessionOutput('b', second)

    deliver('b', 'hello')

    expect(second).toHaveBeenCalledWith('hello')
    expect(first).not.toHaveBeenCalled()
    stopFirst()
    stopSecond()
  })

  it('costs one IPC listener however many sessions subscribe', () => {
    const stops = ['a', 'b', 'c'].map((id) => subscribeToSessionOutput(id, vi.fn()))
    expect(onOutput).toHaveBeenCalledTimes(1)
    stops.forEach((stop) => stop())
  })

  it('stops delivering to a session that unsubscribed, and keeps the others', () => {
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = subscribeToSessionOutput('a', first)
    const stopSecond = subscribeToSessionOutput('b', second)

    stopFirst()
    deliver('a', 'late')
    deliver('b', 'still here')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('still here')
    expect(removeListener).not.toHaveBeenCalled()
    stopSecond()
  })

  it('removes the IPC listener with the last subscriber and installs a new one for the next', () => {
    const stop = subscribeToSessionOutput('a', vi.fn())
    stop()
    expect(removeListener).toHaveBeenCalledTimes(1)

    const next = vi.fn()
    const stopNext = subscribeToSessionOutput('a', next)
    deliver('a', 'again')

    expect(onOutput).toHaveBeenCalledTimes(2)
    expect(next).toHaveBeenCalledWith('again')
    stopNext()
  })

  it('ignores output for a session nobody is subscribed to', () => {
    const stop = subscribeToSessionOutput('a', vi.fn())
    expect(() => deliver('unknown', 'x')).not.toThrow()
    stop()
  })

  it('does not let a stale unsubscribe remove a newer subscriber for the same session', () => {
    const old = subscribeToSessionOutput('a', vi.fn())
    const newer = vi.fn()
    const stopNewer = subscribeToSessionOutput('a', newer)

    old()
    deliver('a', 'data')

    expect(newer).toHaveBeenCalledWith('data')
    stopNewer()
  })
})
