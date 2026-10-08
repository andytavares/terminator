import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  readRefineryState,
  writeRefineryState,
  finalCheckSendBacks,
  sendsBackFinalCheck,
} from '../../src/line/refinery-state.js'
import { raiseGate } from '../../src/gates/rules.js'
import type { Gate } from '../../src/gates/rules.js'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'fdry-refinery-state-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('readRefineryState', () => {
  it('defaults to never-merged when nothing was ever written', async () => {
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: [],
    })
  })

  it('defaults on a malformed file rather than throwing', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), 'not json')
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: [],
    })
  })

  it('reads back exactly what was written', async () => {
    await writeRefineryState(root, 'WO-1', {
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: ['WO-2'],
    })
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: ['WO-2'],
    })
  })

  it('is scoped per order', async () => {
    await writeRefineryState(root, 'WO-1', {
      mergedAt: '2026-09-06T10:00:00.000Z',
      restackedFor: [],
    })
    expect(await readRefineryState(root, 'WO-2')).toEqual({
      mergedAt: null,
      restackedFor: [],
    })
  })

  it('defaults mergedAt when it is not a string, and drops non-string restackedFor entries', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'refinery.json'),
      JSON.stringify({ mergedAt: 12345, restackedFor: ['WO-2', 7, null] })
    )
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: ['WO-2'],
    })
  })

  it('defaults restackedFor when the file has none at all', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), JSON.stringify({ mergedAt: null }))
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: [],
    })
  })

  it('defaults on a JSON array rather than an object', async () => {
    const dir = path.join(root, 'orders', 'WO-1')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'refinery.json'), JSON.stringify([1, 2, 3]))
    expect(await readRefineryState(root, 'WO-1')).toEqual({
      mergedAt: null,
      restackedFor: [],
    })
  })
})

function gate(over: Partial<Parameters<typeof raiseGate>[0]> = {}, option?: string): Gate {
  const raised = raiseGate({
    id: 'g',
    rule: 'verify.repeat-fail',
    orderId: 'WO-1',
    summary: 's',
    why: 'w',
    at: '2026-09-06T10:00:00.000Z',
    ...over,
  })
  return option === undefined
    ? raised
    : { ...raised, decision: { option, at: '2026-09-06T11:00:00.000Z', by: 'operator' } as never }
}

describe('finalCheckSendBacks', () => {
  it('counts only decided send-backs of the final check', () => {
    expect(
      finalCheckSendBacks([
        gate({}, 'send_back'),
        gate({}, 'send_back'),
        gate({}, 'hold'),
        gate({}),
        gate({ nodeId: 'build' }, 'send_back'),
        gate({ rule: 'verify.base-fail' }, 'send_back'),
        gate({ rule: 'verify.base-fail' }, 'accept_debt'),
      ])
    ).toBe(3)
  })
})

describe('sendsBackFinalCheck', () => {
  // A failure already on the base branch is fixed inside this order: nothing
  // opens a second order the operator did not start.
  it('sends a base-branch failure back to this order the same way as its own', () => {
    expect(sendsBackFinalCheck(gate({ rule: 'verify.base-fail' }), 'send_back')).toBe(true)
    expect(sendsBackFinalCheck(gate(), 'send_back')).toBe(true)
  })

  it('leaves a node’s own retry, other answers and other rules alone', () => {
    expect(sendsBackFinalCheck(gate({ nodeId: 'build' }), 'send_back')).toBe(false)
    expect(sendsBackFinalCheck(gate({ rule: 'verify.base-fail' }), 'accept_debt')).toBe(false)
    expect(sendsBackFinalCheck(gate({ rule: 'ci.red' }), 'send_back')).toBe(false)
    expect(sendsBackFinalCheck(gate(), undefined)).toBe(false)
  })
})
