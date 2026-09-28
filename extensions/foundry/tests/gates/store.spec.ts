import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { askOnce, createGateStore } from '../../src/gates/store.js'
import { decide, raiseGate } from '../../src/gates/rules.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-gates-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function shipGate(): ReturnType<typeof raiseGate> {
  return raiseGate({
    id: 'WO-0928-0bb-ship',
    rule: 'risk.p0',
    orderId: 'WO-0928-0bb',
    summary: 'Push and open a draft pull request?',
    why: 'This order is graded highest risk.',
    riskGrade: 'P0',
    blockedUnits: 1,
    at: '2026-09-28T19:17:14.980Z',
  })
}

describe('askOnce', () => {
  it('puts a new question in front of the operator and holds', async () => {
    const store = createGateStore(root)
    expect(await askOnce(store, shipGate())).toBe('hold')
    expect((await store.get('WO-0928-0bb-ship'))?.decision).toBeNull()
  })

  it('takes the approval already on file rather than asking again', async () => {
    const store = createGateStore(root)
    await store.save(decide(shipGate(), 'approve', '', '2026-09-28T19:18:00.000Z'))
    expect(await askOnce(store, shipGate())).toBe('approve')
    expect((await store.get('WO-0928-0bb-ship'))?.decision?.option).toBe('approve')
  })

  it('asks again after a hold', async () => {
    const store = createGateStore(root)
    await store.save(decide(shipGate(), 'hold', '', '2026-09-28T19:18:00.000Z'))
    expect(await askOnce(store, shipGate())).toBe('hold')
    expect((await store.get('WO-0928-0bb-ship'))?.decision).toBeNull()
  })
})
