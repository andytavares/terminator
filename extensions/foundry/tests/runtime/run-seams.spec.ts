import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  setSupervisedRunner,
  supervisedRunner,
  setPermissionSink,
  notePermissionPending,
  notePermissionResolved,
  setRunSupervision,
  runSupervision,
  setReadOnlyStateDir,
  readOnlyStateDirectory,
} from '../../src/runtime/run-seams.js'
import type { PendingAsk } from '../../src/runtime/pending-permissions.js'

// Four seams between the extension's wiring and a supervised run.
//
// Each of them is null until something sets it, and the reason that matters is
// the same every time: absent must read as "ask somebody" or "refuse", never as
// a quiet fallback to running unsupervised.

const ASK: PendingAsk = {
  requestId: 'r-1',
  sessionId: 's-1',
  toolName: 'Write',
  input: { file_path: '/repo/a.ts' },
  askedAt: 1,
}

beforeEach(() => {
  setSupervisedRunner(null)
  setPermissionSink(null)
  setRunSupervision(null)
  setReadOnlyStateDir(null)
})

describe('the supervised runner seam', () => {
  it('is null until one is installed', () => {
    expect(supervisedRunner()).toBeNull()
  })

  it('hands back the runner that was installed', () => {
    const runner = { dispose: vi.fn() } as never
    setSupervisedRunner(runner)
    expect(supervisedRunner()).toBe(runner)
  })

  it('can be taken away again, so a torn-down host does not look supervised', () => {
    setSupervisedRunner({ dispose: vi.fn() } as never)
    setSupervisedRunner(null)
    expect(supervisedRunner()).toBeNull()
  })
})

describe('the permission sink', () => {
  it('swallows a held tool call when nothing is listening, rather than throwing', () => {
    expect(() => notePermissionPending(ASK)).not.toThrow()
    expect(() => notePermissionResolved('r-1', { behavior: 'allow' } as never)).not.toThrow()
  })

  it('passes a held call to whatever is listening', () => {
    const onPending = vi.fn()
    const onResolved = vi.fn()
    setPermissionSink({ onPending, onResolved })

    notePermissionPending(ASK)
    notePermissionResolved('r-1', { behavior: 'deny', message: 'read-only' } as never)

    expect(onPending).toHaveBeenCalledWith(ASK)
    expect(onResolved).toHaveBeenCalledWith('r-1', { behavior: 'deny', message: 'read-only' })
  })

  it('stops delivering once the sink is cleared', () => {
    const onPending = vi.fn()
    setPermissionSink({ onPending, onResolved: vi.fn() })
    setPermissionSink(null)
    notePermissionPending(ASK)
    expect(onPending).not.toHaveBeenCalled()
  })
})

describe('the supervision seam', () => {
  it('is null until one is installed', () => {
    expect(runSupervision()).toBeNull()
  })

  it('hands back what a run reports to', async () => {
    const supervision = { measure: vi.fn(), finishTurn: vi.fn(), finish: vi.fn() }
    setRunSupervision(supervision)
    await runSupervision()?.measure('s-1')
    expect(supervision.measure).toHaveBeenCalledWith('s-1')
  })
})

describe('the read-only state directory', () => {
  it('is null when nothing could be written, so a caller refuses rather than falls back', () => {
    expect(readOnlyStateDirectory()).toBeNull()
  })

  it('hands back the directory that was set', () => {
    setReadOnlyStateDir('/data/.foundry/orders/WO-1')
    expect(readOnlyStateDirectory()).toBe('/data/.foundry/orders/WO-1')
  })
})
