import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { e2eSpecsOf, waitForQuiet } from '../../../scripts/ci-e2e-local.mjs'

/** A machine whose load reads each value in turn, then stays at the last. */
function machine(loads: number[], cores = 16) {
  let read = 0
  let waited = 0
  return {
    readLoad: () => loads[Math.min(read++, loads.length - 1)],
    cores,
    pause: async (ms: number) => {
      waited += ms
    },
    waited: () => waited,
  }
}

describe('waiting for a quiet machine before the e2e suite', () => {
  it('starts at once on a quiet machine', async () => {
    const quiet = machine([2])
    expect(await waitForQuiet({ ...quiet, limitMs: 180_000 })).toBe(true)
    expect(quiet.waited()).toBe(0)
  })

  it('waits for the load the checks before it left to settle', async () => {
    const settling = machine([9, 7, 5])
    expect(await waitForQuiet({ ...settling, limitMs: 180_000 })).toBe(true)
    expect(settling.waited()).toBeGreaterThan(0)
  })

  it('gives up once the limit passes on a machine that stays loaded', async () => {
    const busy = machine([12])
    expect(await waitForQuiet({ ...busy, limitMs: 30_000 })).toBe(false)
    expect(busy.waited()).toBeGreaterThanOrEqual(30_000)
  })
})

describe('which e2e specs the local run gives its shards', () => {
  const allSpecs = ['a.spec.ts', 'b.spec.ts', 'c.spec.ts']

  it('gives every spec when the selection says all', () => {
    expect(e2eSpecsOf({ e2eMode: 'all', e2e: [] }, allSpecs)).toEqual(allSpecs)
  })

  it('gives only the specs a narrower selection names', () => {
    expect(e2eSpecsOf({ e2eMode: 'some', e2e: ['b.spec.ts'] }, allSpecs)).toEqual(['b.spec.ts'])
  })

  it('runs each spec once: no burn-in or repeat is left in the script', () => {
    const source = readFileSync(resolve(__dirname, '../../../scripts/ci-e2e-local.mjs'), 'utf8')
    expect(source).not.toMatch(/burn|repeat/i)
  })
})
