import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createStallSurfacer } from '../../../../../src/main/supervision/stall/surface-stall.js'
import { createFiringLog } from '../../../../../src/main/supervision/stall/firing-log.js'
import type { StallFiring } from '../../../../../src/main/supervision/stall/evaluate-stall.js'

// Shadow mode is a real, global, default-ON mode (FR-018). It gates the
// consequence of a firing, never the record — one code path, one boolean,
// checked here at the surfacing step and nowhere inside evaluateStall.

let dir: string

beforeEach(() => (dir = mkdtempSync(join(tmpdir(), 'surface-'))))
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function harness(initialShadow?: boolean) {
  const store = { value: initialShadow as boolean | undefined }
  const log = createFiringLog(join(dir, 'firings.jsonl'))
  const setStalled = vi.fn()
  const postFeedEntry = vi.fn()
  const notify = vi.fn()
  const surfacer = createStallSurfacer({
    log,
    setStalled,
    postFeedEntry,
    notify,
    shadowStore: {
      get: () => store.value,
      set: (v: boolean) => (store.value = v),
    },
  })
  return { surfacer, log, setStalled, postFeedEntry, notify }
}

const firing: StallFiring = {
  sessionId: 's1',
  signal: 'silence',
  firedAt: 1_000,
  inputs: {
    toolSilenceMs: 9 * 60_000,
    diffSilenceMs: 0,
    distinctFiles: 0,
    netChange: 0,
    reverts: 0,
    shellInFlight: false,
  },
}

describe('shadow mode defaults on (FR-018)', () => {
  it('is on when nothing has been stored', () => {
    expect(harness(undefined).surfacer.isShadowMode()).toBe(true)
  })

  it('records the firing but changes nothing the operator can see', () => {
    const { surfacer, log, setStalled, postFeedEntry, notify } = harness(undefined)
    surfacer.surface(firing)
    expect(log.list()).toHaveLength(1)
    expect(log.list()[0].shadowMode).toBe(true)
    expect(setStalled).not.toHaveBeenCalled()
    expect(postFeedEntry).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('with shadow mode off (FR-019)', () => {
  it('sets the session to stalled', () => {
    const { surfacer, setStalled } = harness(false)
    surfacer.surface(firing)
    expect(setStalled).toHaveBeenCalledWith('s1', firing)
  })

  it('posts a feed entry attributed to the console, not the agent (FR-092)', () => {
    const { surfacer, postFeedEntry } = harness(false)
    surfacer.surface(firing)
    expect(postFeedEntry).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', author: 'console' })
    )
  })

  it('notifies the operator', () => {
    const { surfacer, notify } = harness(false)
    surfacer.surface(firing)
    expect(notify).toHaveBeenCalled()
  })

  it('still records the firing, so precision is measurable in both modes', () => {
    const { surfacer, log } = harness(false)
    surfacer.surface(firing)
    expect(log.list()[0].shadowMode).toBe(false)
  })

  it('names the signal in the feed entry, so a stall is diagnosable from the feed', () => {
    const { surfacer, postFeedEntry } = harness(false)
    surfacer.surface({ ...firing, signal: 'loop' })
    expect(postFeedEntry.mock.calls[0][0].summary).toContain('loop')
  })
})

describe('toggling', () => {
  it('turning shadow mode off changes behaviour with no code change', () => {
    const { surfacer, setStalled } = harness(undefined)
    surfacer.surface(firing)
    expect(setStalled).not.toHaveBeenCalled()
    surfacer.setShadowMode(false)
    surfacer.surface({ ...firing, firedAt: 2_000 })
    expect(setStalled).toHaveBeenCalledOnce()
  })

  it('turning it back on silences the surface again', () => {
    const { surfacer, setStalled } = harness(false)
    surfacer.setShadowMode(true)
    surfacer.surface(firing)
    expect(setStalled).not.toHaveBeenCalled()
  })
})
