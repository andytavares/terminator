import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { recordStall } from '../../src/runtime/supervision-runtime.ts'
import { orderDir } from '../../src/data-root.ts'
import { makeTempDir } from '../../../../tests/support/temp-dir'

const firing = {
  sessionId: 'loose-1',
  signal: 'silent',
  firedAt: Date.parse('2026-10-12T10:00:00Z'),
}

describe('recordStall', () => {
  it("writes the stall on the order's own ledger", async () => {
    const root = makeTempDir('fdry-record-stall-')

    await recordStall(orderDir(root, 'WO-1'), firing)

    const ledger = fs.readFileSync(path.join(orderDir(root, 'WO-1'), 'ledger.jsonl'), 'utf8')
    expect(ledger).toContain('"action":"run.stalled"')
  })

  // A run outside any order has a feature directory that is not
  // `<root>/orders/<id>`. Reading its grandparent as the root wrote a ledger
  // two levels up, `<parent>/orders/scratch/ledger.jsonl`, beside the records.
  it('writes nothing for a feature directory that is not an order directory', async () => {
    const parent = makeTempDir('fdry-record-stall-')

    await recordStall(path.join(parent, 'records', 'scratch'), firing)

    expect(fs.readdirSync(parent)).toEqual([])
  })
})
