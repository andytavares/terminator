import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { OutputRelay, type RendererSend } from '../../../src/main/terminal/output-relay'
import { OUTPUT_FLUSH_INTERVAL_MS } from '../../../src/main/terminal/output-batcher'
import { HIGH_WATERMARK_CHARS, LOW_WATERMARK_CHARS } from '../../../src/main/terminal/flow-control'

function makeFakePtyManager() {
  const dataListeners: Array<(data: string) => void> = []
  const exitListeners: Array<(code: number) => void> = []
  return {
    emitData: (data: string) => dataListeners.forEach((l) => l(data)),
    emitExit: (code: number) => exitListeners.forEach((l) => l(code)),
    onData: vi.fn((_id: string, l: (data: string) => void) => dataListeners.push(l)),
    onExit: vi.fn((_id: string, l: (code: number) => void) => exitListeners.push(l)),
    pause: vi.fn(),
    resume: vi.fn(),
  }
}

let ptyManager: ReturnType<typeof makeFakePtyManager>
let send: Mock<RendererSend>
let relay: OutputRelay

function useRelay(): void {
  beforeEach(() => {
    vi.useFakeTimers()
    ptyManager = makeFakePtyManager()
    send = vi.fn(() => true)
    relay = new OutputRelay(ptyManager as never, send)
    relay.start('s1')
  })

  afterEach(() => {
    vi.useRealTimers()
  })
}

describe('OutputRelay', () => {
  useRelay()

  it('sends the chunks of one frame as one message', () => {
    ptyManager.emitData('a')
    ptyManager.emitData('b')
    vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
    expect(send.mock.calls).toEqual([['terminal:output', { sessionId: 's1', data: 'ab' }]])
  })

  it('sends pending output before the exit, without waiting for the frame', () => {
    ptyManager.emitData('last words')
    ptyManager.emitExit(3)
    expect(send.mock.calls).toEqual([
      ['terminal:output', { sessionId: 's1', data: 'last words' }],
      ['terminal:process-exit', { sessionId: 's1', exitCode: 3 }],
    ])
  })
})

/** Sends `chars` characters of output and lets the frame go out. */
function flood(chars: number): void {
  ptyManager.emitData('x'.repeat(chars))
  vi.advanceTimersByTime(OUTPUT_FLUSH_INTERVAL_MS)
}

describe('OutputRelay — flow control', () => {
  useRelay()

  it('pauses the process when the renderer is too far behind', () => {
    flood(HIGH_WATERMARK_CHARS + 1)
    expect(ptyManager.pause).toHaveBeenCalledWith('s1')
  })

  it('resumes it when the renderer has caught up', () => {
    flood(HIGH_WATERMARK_CHARS + 1)
    relay.acknowledge('s1', HIGH_WATERMARK_CHARS + 1 - LOW_WATERMARK_CHARS + 1)
    expect(ptyManager.resume).toHaveBeenCalledWith('s1')
  })

  it('keeps it paused while the renderer is still behind', () => {
    flood(HIGH_WATERMARK_CHARS + 1)
    relay.acknowledge('s1', 10)
    expect(ptyManager.resume).not.toHaveBeenCalled()
  })
})

describe('OutputRelay — flow control without a window or a session', () => {
  useRelay()

  it('does not count output nobody received, so a missing window never stalls the process', () => {
    send.mockReturnValue(false)
    flood(HIGH_WATERMARK_CHARS * 2)
    expect(ptyManager.pause).not.toHaveBeenCalled()
  })

  it('resumes a paused process when the renderer starts over', () => {
    flood(HIGH_WATERMARK_CHARS + 1)
    relay.reset('s1')
    expect(ptyManager.resume).toHaveBeenCalledWith('s1')
  })

  it('ignores acknowledgements and resets for sessions it does not relay', () => {
    flood(HIGH_WATERMARK_CHARS + 1)
    relay.acknowledge('other', HIGH_WATERMARK_CHARS + 1)
    relay.reset('other')
    expect(ptyManager.resume).not.toHaveBeenCalled()
  })

  it('ignores acknowledgements after the session has exited', () => {
    flood(HIGH_WATERMARK_CHARS + 1)
    ptyManager.emitExit(0)
    relay.acknowledge('s1', HIGH_WATERMARK_CHARS)
    expect(ptyManager.resume).not.toHaveBeenCalled()
  })
})
