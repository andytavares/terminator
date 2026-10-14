import { describe, it, expect, vi, beforeEach } from 'vitest'

type OutputHandler = (sessionId: string, data: string) => void

let deliver: OutputHandler
const acknowledge = vi.fn()
const onOutput = vi.fn((handler: OutputHandler) => {
  deliver = handler
  return vi.fn()
})

// The router keeps its listener for the life of the page, so each test gets a fresh module.
async function freshRouter() {
  vi.resetModules()
  vi.stubGlobal('window', { electronAPI: { terminal: { onOutput, acknowledge } } })
  return import('../../../../src/renderer/terminal/output-router')
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('subscribeToSessionOutput', () => {
  it('hands output to the subscriber of that session only', async () => {
    const { subscribeToSessionOutput } = await freshRouter()
    const first = vi.fn()
    const second = vi.fn()
    subscribeToSessionOutput('a', first)
    subscribeToSessionOutput('b', second)

    deliver('b', 'hello')

    expect(second).toHaveBeenCalledWith('hello', expect.any(Function))
    expect(first).not.toHaveBeenCalled()
  })

  it('costs one IPC listener however many sessions subscribe', async () => {
    const { subscribeToSessionOutput } = await freshRouter()
    ;['a', 'b', 'c'].forEach((id) => subscribeToSessionOutput(id, vi.fn()))
    expect(onOutput).toHaveBeenCalledTimes(1)
  })

  it('stops delivering to a session that unsubscribed, and keeps the others', async () => {
    const { subscribeToSessionOutput } = await freshRouter()
    const first = vi.fn()
    const second = vi.fn()
    const stopFirst = subscribeToSessionOutput('a', first)
    subscribeToSessionOutput('b', second)

    stopFirst()
    deliver('a', 'late')
    deliver('b', 'still here')

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('still here', expect.any(Function))
  })
})

describe('subscribeToSessionOutput — does not let a stale unsubscribe remove a newer subscriber for the same session', () => {
  it('does not let a stale unsubscribe remove a newer subscriber for the same session', async () => {
    const { subscribeToSessionOutput } = await freshRouter()
    const old = subscribeToSessionOutput('a', vi.fn())
    const newer = vi.fn()
    subscribeToSessionOutput('a', newer)

    old()
    deliver('a', 'data')

    expect(newer).toHaveBeenCalledWith('data', expect.any(Function))
  })

  it('acknowledges output when its subscriber says it has been written', async () => {
    const { subscribeToSessionOutput } = await freshRouter()
    subscribeToSessionOutput(
      'a',
      vi.fn((_data: string, written: () => void) => written())
    )

    deliver('a', 'twelve chars')

    expect(acknowledge).toHaveBeenCalledWith('a', 12)
  })

  it('does not acknowledge output before its subscriber has written it', async () => {
    const { subscribeToSessionOutput } = await freshRouter()
    subscribeToSessionOutput('a', vi.fn())
    deliver('a', 'pending')
    expect(acknowledge).not.toHaveBeenCalled()
  })
})

describe('subscribeToSessionOutput — acknowledges output nobody will write at once, so the process is not held up for it', () => {
  it('acknowledges output nobody will write at once, so the process is not held up for it', async () => {
    const { subscribeToSessionOutput } = await freshRouter()
    const stop = subscribeToSessionOutput('a', vi.fn())
    stop()

    deliver('a', 'dropped')

    expect(acknowledge).toHaveBeenCalledWith('a', 7)
  })
})
