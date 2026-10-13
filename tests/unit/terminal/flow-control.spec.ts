import { describe, it, expect, vi } from 'vitest'
import {
  FlowControl,
  HIGH_WATERMARK_CHARS,
  LOW_WATERMARK_CHARS,
} from '../../../src/main/terminal/flow-control'

function makeFlow() {
  const output = { pause: vi.fn(), resume: vi.fn() }
  return { flow: new FlowControl(output), output }
}

describe('FlowControl', () => {
  it('keeps the process running while unacknowledged output is at or below the high watermark', () => {
    const { flow, output } = makeFlow()
    flow.sent(HIGH_WATERMARK_CHARS)
    expect(output.pause).not.toHaveBeenCalled()
  })

  it('pauses the process once unacknowledged output passes the high watermark', () => {
    const { flow, output } = makeFlow()
    flow.sent(HIGH_WATERMARK_CHARS)
    flow.sent(1)
    expect(output.pause).toHaveBeenCalledTimes(1)
  })

  it('pauses once however much more is sent while paused', () => {
    const { flow, output } = makeFlow()
    flow.sent(HIGH_WATERMARK_CHARS + 1)
    flow.sent(1000)
    expect(output.pause).toHaveBeenCalledTimes(1)
  })

  it('stays paused until unacknowledged output falls below the low watermark', () => {
    const { flow, output } = makeFlow()
    flow.sent(HIGH_WATERMARK_CHARS + 1000)
    flow.acknowledged(HIGH_WATERMARK_CHARS + 1000 - LOW_WATERMARK_CHARS)
    expect(output.resume).not.toHaveBeenCalled()

    flow.acknowledged(1)
    expect(output.resume).toHaveBeenCalledTimes(1)
  })
})

describe('FlowControl — after a resume, and acknowledgements', () => {
  it('pauses again after a resume when output outruns the renderer again', () => {
    const { flow, output } = makeFlow()
    flow.sent(HIGH_WATERMARK_CHARS + 1)
    flow.acknowledged(HIGH_WATERMARK_CHARS + 1)
    flow.sent(HIGH_WATERMARK_CHARS + 1)

    expect(output.pause).toHaveBeenCalledTimes(2)
    expect(output.resume).toHaveBeenCalledTimes(1)
  })

  it('does not resume a process it never paused', () => {
    const { flow, output } = makeFlow()
    flow.sent(100)
    flow.acknowledged(100)
    expect(output.resume).not.toHaveBeenCalled()
  })

  it('treats an acknowledgement of more than was sent as everything acknowledged', () => {
    const { flow, output } = makeFlow()
    flow.acknowledged(5000)
    flow.sent(HIGH_WATERMARK_CHARS)
    expect(output.pause).not.toHaveBeenCalled()
  })
})

describe('FlowControl — reset', () => {
  it('resumes a paused process and forgets what was owed when reset', () => {
    const { flow, output } = makeFlow()
    flow.sent(HIGH_WATERMARK_CHARS + 1)
    flow.reset()
    expect(output.resume).toHaveBeenCalledTimes(1)

    flow.sent(HIGH_WATERMARK_CHARS)
    expect(output.pause).toHaveBeenCalledTimes(1)
  })

  it('does not resume on reset when it never paused', () => {
    const { flow, output } = makeFlow()
    flow.sent(10)
    flow.reset()
    expect(output.resume).not.toHaveBeenCalled()
  })
})
