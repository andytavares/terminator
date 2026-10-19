/**
 * Deleting an order while its intake is still running, end to end.
 *
 * `converge` answers as soon as the scout's session exists, and the scout's
 * end is what starts the architect. Delete removes the project, which ends the
 * scout's terminal, so the scout "finishing" arrived after the order was gone:
 * the architect then cut the lane checkout again and opened a new project for
 * an order nobody had any more. On CI the sidebar row came back for good
 * (run 36342472487, foundry-intake.spec.ts:216).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

import { makeTempDir } from '../../../../tests/support/temp-dir'
import { fakeHost, type FoundryHost } from '../helpers/foundry-host.js'
import { activateFoundry } from '../helpers/foundry-activation.js'
import { orderStoreAt } from '../../src/state/live-index.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'
import { theRunner } from '../helpers/supervision-mocks.js'

vi.mock('../../src/runtime/supervised-runner.js', () => import('../helpers/supervision-mocks.js'))
vi.mock('../../src/runtime/control-server.js', () => import('../helpers/supervision-mocks.js'))

let dataDir = ''
let host: FoundryHost

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Make the thing work',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/a'],
    now: '2026-09-06T10:00:00.000Z',
  })
  return { ...base, status: 'draft', recipe: 'direct', ...over }
}

beforeAll(async () => {
  host = fakeHost(() => dataDir)
  host.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', timedOut: false })
  await activateFoundry(host)
})

type Started = {
  phase: string
  onRegistered?: (run: { sessionId: string }) => void
  onEnd?: (exitCode: number | null) => void
}

beforeEach(() => {
  theRunner.start.mockReset()
  theRunner.start.mockImplementation(async (...args: unknown[]) => {
    const input = args[0] as Started
    const sessionId = `session-${theRunner.start.mock.calls.length}`
    input.onRegistered?.({ sessionId })
    return { sessionId }
  })
})

describe('deleting an order while its scout is still reading', () => {
  it('starts nothing more for it once the scout ends, and leaves nothing on disk', async () => {
    dataDir = makeTempDir('fdry-delete-intake-')
    await orderStoreAt(dataDir).save(order())

    // The architect starts at seed, beside the scout rather than after it.
    await host.call('foundry:order.converge', { id: 'WO-1' })
    expect(theRunner.start).toHaveBeenCalledTimes(2)
    const started = theRunner.start.mock.calls.map((c) => c[0] as Started)

    await host.call('foundry:order.delete', { id: 'WO-1' })
    // Deleting the project closes both terminals.
    for (const run of started) run.onEnd?.(0)
    // What would follow is a chain of file reads and writes; let it run out.
    await new Promise((settle) => setTimeout(settle, 200))

    expect(theRunner.start).toHaveBeenCalledTimes(2)
    expect(fs.existsSync(path.join(dataDir, 'orders', 'WO-1'))).toBe(false)
  })
})
