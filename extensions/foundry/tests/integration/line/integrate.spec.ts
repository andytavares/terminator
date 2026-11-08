import { describe, it, expect, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { shipOrder } from '../../../src/line/integrate.js'
import type { IntegrateDeps, ShellExec } from '../../../src/line/integrate.js'
import { createOrderStore } from '../../../src/order/store.js'
import { draftOrder } from '../../../src/order/draft.js'
import type { WorkOrder } from '../../../src/order/schema.js'
import { makeVerdict } from '../../../src/verify/verdict.js'
import { makeTempDir } from '../../../../../tests/support/temp-dir'

// Shipping writes through the real order store, so the ledger file an entry lands in is
// asserted, not only the arguments `record` received (docs/ARCHITECTURE.md, "The ledger").

let root: string

function shippableOrder(): WorkOrder {
  const base = draftOrder({
    id: 'WO-1',
    title: 'Refuse an expired refresh token',
    source: { kind: 'typed', tracker: null, key: null, url: null },
    repoPaths: ['/repos/app'],
    now: '2026-09-06T10:00:00.000Z',
  })
  const repo = {
    name: 'app',
    path: '/repos/app',
    lane: 1,
    baseBranch: 'main',
    headBranch: 'foundry/wo-1',
  }
  return { ...base, status: 'running', context: { ...base.context, repos: [repo] } }
}

/** `gh pr create` answers with a GitHub URL; every other command succeeds silently. */
const exec: ShellExec = async (options) => {
  const created = options.command === 'gh' && options.args[1] === 'create'
  const stdout = created ? 'https://github.com/tav/app/pull/7\n' : ''
  return { exitCode: 0, stdout, stderr: '', timedOut: false }
}

function shipDeps(): IntegrateDeps {
  return {
    exec,
    root,
    now: () => '2026-09-06T12:00:00.000Z',
    autoOpen: true,
    decide: async () => 'hold',
    record: async (action, subject, reason) =>
      createOrderStore(root).record({
        at: '2026-09-06T12:00:00.000Z',
        orderId: 'WO-1',
        actor: 'rule:ship',
        action,
        subject,
        reason,
        evidence: [],
      }),
  }
}

const passed = makeVerdict({
  nodeId: 'N-1',
  criterionId: 'AC-1',
  result: 'pass',
  reason: '',
  evidence: [{ kind: 'exit_code', exitCode: 0 }],
  producedBy: { role: 'verifier', sessionId: 's-verify' },
  nodeSessionId: null,
  at: '2026-09-06T10:00:00.000Z',
})

beforeEach(() => {
  root = makeTempDir('fdry-ship-ledger-')
})

describe('shipping, through the order store', () => {
  // `ship.draft_opened`'s subject is the pull request URL; filing by subject once put it in
  // `orders/https:/github.com/…/ledger.jsonl`, not here.
  it("records the draft in the order's own ledger, and nowhere else", async () => {
    await shipOrder(shippableOrder(), { verdicts: [passed], findings: [] }, shipDeps())

    const actions = (await createOrderStore(root).entries('WO-1')).map((entry) => entry.action)
    expect(actions).toContain('ship.draft_opened')
    expect(fs.readdirSync(path.join(root, 'orders'))).toEqual(['WO-1'])
  })
})
