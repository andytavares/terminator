import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  OutputBatcher,
  OUTPUT_FLUSH_INTERVAL_MS,
  OUTPUT_FLUSH_MAX_CHARS,
} from '../../../src/main/terminal/output-batcher'

const send = vi.fn()

function useFakeFrameClock(): void {
  beforeEach(() => {
    vi.useFakeTimers()
    send.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })
}

describe('OutputBatcher', () => {
  useFakeFrameClock()

  it('sends the chunks of one frame as a single message, in order', () => {
    const batcher = new OutputBatcher(send)
    batcher.push('one ')
    batcher.push('two ')
    batcher.push('three')
    expect(send).not.toHaveBeenCalled()

    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('one two three')
  })

  it('starts a new frame with the next chunk after a flush', () => {
    const batcher = new OutputBatcher(send)
    batcher.push('a')
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
    batcher.push('b')
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)

    expect(send.mock.calls).toEqual([['a'], ['b']])
  })

  it('does not stretch the frame when more output keeps arriving', () => {
    const batcher = new OutputBatcher(send)
    batcher.push('a')
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS - 1)
    batcher.push('b')
    vi.advanceTimersByTime(1)

    expect(send).toHaveBeenCalledWith('ab')
  })
})

describe('OutputBatcher — size cap and flushing', () => {
  useFakeFrameClock()

  it('sends at once when the batch reaches the size cap', () => {
    const batcher = new OutputBatcher(send)
    const big = 'x'.repeat(OUTPUT_FLUSH_MAX_CHARS)
    batcher.push('head')
    batcher.push(big)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(`head${big}`)
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('sends what is pending when asked to flush, and not again on the timer', () => {
    const batcher = new OutputBatcher(send)
    batcher.push('last words')
    batcher.flush()
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS * 2)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('last words')
  })

  it('sends nothing when there is nothing pending', () => {
    const batcher = new OutputBatcher(send)
    batcher.flush()
    expect(send).not.toHaveBeenCalled()
  })
})
