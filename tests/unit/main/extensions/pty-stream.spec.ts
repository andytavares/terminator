import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BatchedPtyStream } from '../../../../src/main/extensions/pty-stream'
import { OUTPUT_FLUSH_INTERVAL_MS } from '../../../../src/main/terminal/output-batcher'

/** A PTY source with one session whose output and exit the test drives. */
function fakeSource() {
  const data = new Set<(chunk: string) => void>()
  const exits = new Set<(code: number) => void>()
  return {
    onData: (sessionId: string, listener: (chunk: string) => void) => {
      if (sessionId !== 'live') return null
      data.add(listener)
      return () => data.delete(listener)
    },
    onExit: (sessionId: string, listener: (code: number) => void) => {
      if (sessionId !== 'live') return null
      exits.add(listener)
      return () => exits.delete(listener)
    },
    write: (chunk: string) => data.forEach((listener) => listener(chunk)),
    exit: (code: number) => exits.forEach((listener) => listener(code)),
  }
}

describe('BatchedPtyStream', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('delivers the chunks of one frame as one batch', () => {
    const source = fakeSource()
    const received: string[] = []
    new BatchedPtyStream(source).onData('live', (chunk) => received.push(chunk))

    source.write('a')
    source.write('b')
    expect(received).toEqual([])
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
    expect(received).toEqual(['ab'])
  })

  it('delivers pending output before the exit, whichever listener came first', () => {
    const source = fakeSource()
    const stream = new BatchedPtyStream(source)
    const events: string[] = []
    stream.onExit('live', (code) => events.push(`exit ${code}`))
    stream.onData('live', (chunk) => events.push(chunk))

    source.write('last words')
    source.exit(3)
    expect(events).toEqual(['last words', 'exit 3'])
  })

  it('stops delivering once disposed, including a batch still pending', () => {
    const source = fakeSource()
    const received: string[] = []
    const dispose = new BatchedPtyStream(source).onData('live', (chunk) => received.push(chunk))

    source.write('pending')
    dispose()
    source.write('after')
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
    expect(received).toEqual([])
  })

  it('returns a disposer that does nothing for a session that does not exist', () => {
    const stream = new BatchedPtyStream(fakeSource())
    const listener = vi.fn()
    expect(() => stream.onData('gone', listener)()).not.toThrow()
    expect(() => stream.onExit('gone', listener)()).not.toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})
