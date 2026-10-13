import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as path from 'node:path'

import { fakeHost, temporaryDirectory, type FoundryHost } from '../helpers/foundry-host.js'
import { issuesPortFor, writeBackDepsFor } from '../../src/trackers/issues-port.js'
import { checkCapability, writeBack } from '../../src/trackers/write-back.js'
import { createOrderStore } from '../../src/order/store.js'
import { draftOrder } from '../../src/order/draft.js'
import type { WorkOrder } from '../../src/order/schema.js'

// Write-back over the application's own tracker connection: what reaches the
// issue, and what the order's ledger says about it.

let root: string
let host: FoundryHost

function trackedOrder(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-1',
      title: 'Make it red',
      source: { kind: 'tracker', tracker: 'linear', key: 'ENG-1', url: null },
      repoPaths: ['/repos/app'],
      now: '2026-10-12T10:00:00.000Z',
    }),
    writeBack: ['summary_comment', 'status'],
    ...over,
  }
}

beforeEach(async () => {
  root = path.join(temporaryDirectory('fdry-issues-port'), 'records')
  host = fakeHost(() => root)
  vi.mocked(host.issues.supportsTransitions).mockReturnValue(true)
  await createOrderStore(root).save(trackedOrder())
})

async function ledger(): Promise<Array<{ action: string; actor: string }>> {
  return createOrderStore(root).entries('WO-1')
}

describe('an agreed order from a tracker issue', () => {
  describe('the agreed order comment', theAgreedOrderCommentTests)
  describe('the state move', theStateMoveTests)
})

function theAgreedOrderCommentTests() {
  it('comments the agreed order on the issue and records it as the write-back rule', async () => {
    const order = trackedOrder()
    await writeBack(order, 'agreed', writeBackDepsFor(root, order, issuesPortFor(host.api)))
    expect(host.issues.comment).toHaveBeenCalledWith(
      'linear',
      'ENG-1',
      expect.stringContaining('Make it red')
    )
    expect((await ledger()).map((entry) => entry.actor)).toEqual(['rule:writeback'])
  })
}

function theStateMoveTests() {
  it('moves the issue to the state the operator mapped, and lets the tracker choose where none is', async () => {
    const mapped = trackedOrder({
      stateMapping: { started: 'state-42', in_review: null, done: null },
    })
    const deps = writeBackDepsFor(root, mapped, issuesPortFor(host.api))
    await writeBack(mapped, 'started', deps)
    await writeBack(mapped, 'draft_opened', deps)
    expect(vi.mocked(host.issues.transition).mock.calls).toEqual([
      ['linear', 'ENG-1', 'started', 'state-42'],
      ['linear', 'ENG-1', 'in_review', undefined],
    ])
  })

  it('reads which states the issue can move to before the run, not after', async () => {
    vi.mocked(host.issues.states).mockResolvedValueOnce([
      { id: 's1', name: 'In Progress', intent: 'started', available: true },
    ] as never)
    const order = trackedOrder()
    const report = await checkCapability(
      order,
      writeBackDepsFor(root, order, issuesPortFor(host.api))
    )
    expect(host.issues.states).toHaveBeenCalledWith('linear', 'ENG-1')
    expect(report).toMatchObject({ transitions: 'supported', unreachable: ['in_review', 'done'] })
  })
}
