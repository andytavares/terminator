import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  busiestProcesses,
  e2eSpecsOf,
  playwrightArguments,
  runShardsTogether,
  waitForQuiet,
} from '../../../scripts/ci-e2e-local.mjs'

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

  it('runs each spec once, and leaves the repeats to CI (Constitution XIV, ADR 132)', () => {
    const source = readFileSync(resolve(__dirname, '../../../scripts/ci-e2e-local.mjs'), 'utf8')
    expect(source).not.toMatch(/--repeat-each/)
    expect(source).not.toMatch(/scripts\/stability\.mjs/)
  })
})

// A busy machine is refused; the refusal names what is busy, so a process left behind (ten
// orphaned `yes` loads once ran for four hours) is seen at once rather than waited out.
describe('what keeps the machine busy', () => {
  const ps = [
    '%CPU COMM',
    '  0.4 /usr/sbin/cfprefsd',
    '100.0 yes',
    ' 99.6 yes',
    ' 55.7 com.apple.Virtualization.VirtualMachine',
    '  1.0 node',
  ].join('\n')

  it('lists the busiest processes, busiest first, with their share of a core', () => {
    expect(busiestProcesses(ps, 3)).toEqual([
      '100.0%  yes',
      '99.6%  yes',
      '55.7%  com.apple.Virtualization.VirtualMachine',
    ])
  })
})

describe('shards that run side by side', () => {
  it('gives each shard its own Playwright output directory, so one start does not clear another', () => {
    const args = playwrightArguments(2, ['a.spec.ts'])
    expect(args).toEqual(expect.arrayContaining(['--output', 'test-results/shard-2']))
    expect(playwrightArguments(3, ['a.spec.ts'])).toContain('test-results/shard-3')
  })

  it('starts every shard before the first ends', async () => {
    let started = 0
    let release = () => {}
    const allStarted = new Promise<void>((resolve) => (release = resolve))
    const run = async () => {
      if (++started === 3) release()
      await allStarted // a shard run in turn would wait here forever
      return true
    }
    expect(await runShardsTogether([1, 2, 3], run)).toEqual([])
    expect(started).toBe(3)
  })

  it('names the shards that failed', async () => {
    const run = async (shard: number) => shard !== 2
    expect(await runShardsTogether([1, 2, 3], run)).toEqual([2])
  })
})
