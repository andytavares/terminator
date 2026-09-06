import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createInboxChannels } from '../../src/ipc/inbox-channels.js'
import { createGateStore, createLiveGateStore } from '../../src/gates/store.js'
import { createOrderStore } from '../../src/order/store.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { Gate } from '../../src/gates/rules.js'
import type { Autonomy } from '../../src/gates/autonomy.js'
import { draftOrder } from '../../src/order/schema.js'
import type { WorkOrder } from '../../src/order/schema.js'

// One queue, always sorted, every row attributable to a rule. "Nothing needs
// you" only means something if nothing can reach this list without a rule
// having produced it.

let root: string
let record: ReturnType<typeof vi.fn>

function channels(autonomy: Autonomy = 'standard') {
  record = vi.fn(async () => undefined)
  return createInboxChannels({
    gates: createGateStore(root),
    orders: createOrderStore(root),
    autonomy: () => autonomy,
    now: () => '2026-09-06T12:00:00.000Z',
    record: record as never,
  })
}

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}): Gate {
  return raiseGate({
    id: 'G-1',
    rule: 'risk.p0',
    orderId: 'WO-1',
    summary: 'touches session refresh',
    why: 'the diff touches src/main/auth/session.ts',
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  })
}

function order(over: Partial<WorkOrder> = {}): WorkOrder {
  return {
    ...draftOrder({
      id: 'WO-1',
      title: 'x',
      source: { kind: 'typed', tracker: null, key: null, url: null },
      repoPaths: ['/repos/a'],
      now: '2026-09-06T10:00:00.000Z',
    }),
    ...over,
  }
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-inbox-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('foundry:inbox.list', () => {
  it('is empty before anything has been raised', async () => {
    const r = (await channels().list()) as { gates: Gate[] }
    expect(r.gates).toEqual([])
  })

  it('lists a raised gate with the rule that produced it', async () => {
    await createGateStore(root).save(gate())
    const r = (await channels().list()) as { gates: Gate[] }
    expect(r.gates).toHaveLength(1)
    expect(r.gates[0].rule).toBe('risk.p0')
    expect(r.gates[0].why).toContain('session.ts')
  })

  it('ranks what unblocks the most work first', async () => {
    const store = createGateStore(root)
    await store.save(gate({ id: 'G-idle', blockedUnits: 0 }))
    await store.save(gate({ id: 'G-busy', blockedUnits: 4 }))
    const r = (await channels().list()) as { gates: Gate[] }
    expect(r.gates.map((g) => g.id)).toEqual(['G-busy', 'G-idle'])
  })

  it('hides a gate whose rule this autonomy setting silences', async () => {
    await createGateStore(root).save(gate({ id: 'G-unit', rule: 'unit.boundary' }))
    expect(((await channels('standard').list()) as { gates: Gate[] }).gates).toHaveLength(0)
    expect(((await channels('escorted').list()) as { gates: Gate[] }).gates).toHaveLength(1)
  })

  it('never hides the four that are live at every setting', async () => {
    const store = createGateStore(root)
    for (const rule of ['risk.p0', 'budget.exceeded', 'destructive', 'ready-for-review'] as const) {
      await store.save(gate({ id: `G-${rule}`, rule }))
    }
    const r = (await channels('lights-out').list()) as { gates: Gate[] }
    expect(r.gates).toHaveLength(4)
  })

  it('takes the stated default once a deadline has passed, and records it as automatic', async () => {
    await createGateStore(root).save(gate({ id: 'G-late', deadline: '2026-09-06T11:00:00.000Z' }))
    const c = channels()
    const r = (await c.list()) as { gates: Gate[] }
    expect(r.gates).toHaveLength(0)
    expect(record).toHaveBeenCalledWith(
      'WO-1',
      'gate.default',
      'G-late',
      expect.stringContaining('no answer')
    )
    expect((await createGateStore(root).get('G-late'))?.decision?.by).toBe('default')
  })

  it('leaves a gate with no deadline waiting, however long', async () => {
    await createGateStore(root).save(gate({ id: 'G-patient', deadline: null }))
    expect(((await channels().list()) as { gates: Gate[] }).gates).toHaveLength(1)
  })

  it('counts what is building and what is converging, for the empty state', async () => {
    const orders = createOrderStore(root)
    await orders.save(order({ id: 'WO-run', status: 'running' }))
    await orders.save(order({ id: 'WO-draft', status: 'draft' }))
    const r = (await channels().list()) as { summary: { building: number; converging: number } }
    expect(r.summary.building).toBe(1)
    expect(r.summary.converging).toBe(1)
  })

  it('counts the decisions taken without anyone', async () => {
    await createGateStore(root).save(gate({ id: 'G-late', deadline: '2026-09-06T11:00:00.000Z' }))
    const r = (await channels().list()) as { summary: { automatic: number } }
    expect(r.summary.automatic).toBe(1)
  })
})

describe('foundry:inbox.decide', () => {
  it('records the decision and keeps it', async () => {
    await createGateStore(root).save(gate())
    const c = channels()
    const r = (await c.decide({ gateId: 'G-1', option: 'approve', note: 'read the diff' })) as {
      ok: true
      gate: Gate
    }
    expect(r.ok).toBe(true)
    expect(r.gate.decision?.option).toBe('approve')
    expect((await createGateStore(root).get('G-1'))?.decision?.by).toBe('operator')
  })

  it('writes the decision to the ledger before acting on it', async () => {
    await createGateStore(root).save(gate())
    const c = channels()
    await c.decide({ gateId: 'G-1', option: 'approve' })
    expect(record).toHaveBeenCalledWith(
      'WO-1',
      'gate.decided',
      'G-1',
      expect.stringContaining('risk.p0 -> approve')
    )
  })

  it('refuses an option the gate never offered', async () => {
    await createGateStore(root).save(gate())
    const r = (await channels().decide({ gateId: 'G-1', option: 'ship_it' })) as { error: string }
    expect(r.error).toMatch(/not one of the options/)
  })

  it('refuses to decide the same gate twice, and says what was chosen', async () => {
    await createGateStore(root).save(gate())
    const c = channels()
    await c.decide({ gateId: 'G-1', option: 'approve' })
    const again = (await c.decide({ gateId: 'G-1', option: 'send_back' })) as { error: string }
    expect(again.error).toMatch(/already decided \(approve\)/)
  })

  it('reports a gate it cannot find', async () => {
    expect(await channels().decide({ gateId: 'G-nope', option: 'approve' })).toEqual({
      error: 'No gate G-nope.',
    })
  })

  it('rejects a malformed request', async () => {
    expect(await channels().decide({ nope: true })).toEqual({ error: 'Malformed request.' })
  })

  it('takes a decision with no note', async () => {
    await createGateStore(root).save(gate())
    const r = (await channels().decide({ gateId: 'G-1', option: 'hold' })) as { ok: true }
    expect(r.ok).toBe(true)
  })
})

describe('createGateStore', () => {
  it('replaces a gate rather than duplicating it', async () => {
    const store = createGateStore(root)
    await store.save(gate())
    await store.save({ ...gate(), summary: 'changed' })
    const all = await store.forOrder('WO-1')
    expect(all).toHaveLength(1)
    expect(all[0].summary).toBe('changed')
  })

  it('keeps each order gates apart', async () => {
    const store = createGateStore(root)
    await store.save(gate({ id: 'G-1', orderId: 'WO-1' }))
    await store.save(gate({ id: 'G-2', orderId: 'WO-2' }))
    expect(await store.forOrder('WO-1')).toHaveLength(1)
    expect(await store.list()).toHaveLength(2)
  })

  it('reads an unreadable gate file as no gates rather than throwing', async () => {
    const dir = path.join(root, 'orders', 'WO-bad')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'gates.json'), '{{{')
    expect(await createGateStore(root).list()).toEqual([])
  })
})

describe('the gate store on disk', () => {
  it('finds nothing for an order with no gates', async () => {
    expect(await createGateStore(root).forOrder('WO-none')).toEqual([])
  })

  it('is null for a gate id nobody raised', async () => {
    expect(await createGateStore(root).get('G-nope')).toBeNull()
  })

  it('lists nothing before any order directory exists', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-empty-'))
    expect(await createGateStore(empty).list()).toEqual([])
    fs.rmSync(empty, { recursive: true, force: true })
  })

  it('ignores a gates file that is valid JSON but not a list', async () => {
    const dir = path.join(root, 'orders', 'WO-odd')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'gates.json'), '{"not":"a list"}')
    expect(await createGateStore(root).list()).toEqual([])
  })
})

describe('acting on the decision', () => {
  it('carries out what the operator chose', async () => {
    await createGateStore(root).save(gate({ rule: 'ready-for-review' }))
    const act = vi.fn(async () => undefined)
    const c = createInboxChannels({
      gates: createGateStore(root),
      orders: createOrderStore(root),
      autonomy: () => 'standard',
      now: () => '2026-09-06T12:00:00.000Z',
      record: vi.fn(async () => undefined) as never,
      act,
    })
    await c.decide({ gateId: 'G-1', option: 'mark_ready' })
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({ rule: 'ready-for-review' }),
      'mark_ready'
    )
  })

  it('keeps the decision when the action fails, and says what went wrong', async () => {
    await createGateStore(root).save(gate({ rule: 'ready-for-review' }))
    const c = createInboxChannels({
      gates: createGateStore(root),
      orders: createOrderStore(root),
      autonomy: () => 'standard',
      now: () => '2026-09-06T12:00:00.000Z',
      record: vi.fn(async () => undefined) as never,
      act: async () => {
        throw new Error('gh: not authenticated')
      },
    })
    const result = (await c.decide({ gateId: 'G-1', option: 'mark_ready' })) as {
      ok: true
      actionError: string
    }
    expect(result.ok).toBe(true)
    expect(result.actionError).toContain('not authenticated')
    expect((await createGateStore(root).get('G-1'))?.decision?.option).toBe('mark_ready')
  })

  it('needs no action seam at all', async () => {
    await createGateStore(root).save(gate())
    expect(await channels().decide({ gateId: 'G-1', option: 'approve' })).toMatchObject({
      ok: true,
    })
  })
})

describe('a gate store whose root follows the workspace', () => {
  it('reads and writes wherever the resolver points, on each call', async () => {
    const a = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-live-gates-a-'))
    const b = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-live-gates-b-'))
    let here = a
    const store = createLiveGateStore(() => here)

    await store.save(gate({ id: 'G-a' }))
    here = b
    await store.save(gate({ id: 'G-b' }))

    expect((await createGateStore(a).list()).map((g) => g.id)).toEqual(['G-a'])
    expect((await createGateStore(b).list()).map((g) => g.id)).toEqual(['G-b'])

    // And the reads go through the same resolver as the writes.
    expect((await store.get('G-b'))?.id).toBe('G-b')
    expect(await store.forOrder('WO-1')).toHaveLength(1)
    expect(await store.list()).toHaveLength(1)

    for (const dir of [a, b]) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 })
  })
})

describe('a decision that leaves the run stopped is a decision that did nothing', () => {
  function decided(rule: Parameters<typeof gate>[0]['rule'], option: string) {
    const act = vi.fn(async () => undefined)
    return {
      act,
      run: async () => {
        await createGateStore(root).save(gate({ rule }))
        const c = createInboxChannels({
          gates: createGateStore(root),
          orders: createOrderStore(root),
          autonomy: () => 'escorted',
          now: () => '2026-09-06T12:00:00.000Z',
          record: vi.fn(async () => undefined) as never,
          act,
        })
        await c.decide({ gateId: 'G-1', option })
      },
    }
  }

  it('carries the chosen option through, so the caller can act on which one it was', async () => {
    const { act, run } = decided('verify.repeat-fail', 'send_back')
    await run()
    expect(act).toHaveBeenCalledWith(
      expect.objectContaining({ rule: 'verify.repeat-fail' }),
      'send_back'
    )
  })

  it('carries a hold through too — the caller decides that it means "stay stopped"', async () => {
    const { act, run } = decided('risk.p0', 'hold')
    await run()
    expect(act).toHaveBeenCalledWith(expect.anything(), 'hold')
  })

  it('names the node, so a send-back knows what to retry', async () => {
    const act = vi.fn(async () => undefined)
    await createGateStore(root).save(gate({ rule: 'verify.repeat-fail', nodeId: 'build:U-1' }))
    const c = createInboxChannels({
      gates: createGateStore(root),
      orders: createOrderStore(root),
      autonomy: () => 'escorted',
      now: () => '2026-09-06T12:00:00.000Z',
      record: vi.fn(async () => undefined) as never,
      act,
    })
    await c.decide({ gateId: 'G-1', option: 'send_back' })
    expect((act.mock.calls[0][0] as { nodeId: string | null }).nodeId).toBe('build:U-1')
  })
})
