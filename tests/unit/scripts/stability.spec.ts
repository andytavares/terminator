import { describe, it, expect } from 'vitest'
import {
  burnIn,
  changedSpecs,
  freshSeeds,
  stabilityArguments,
} from '../../../scripts/stability.mjs'

// A flaky test has to fail on the pull request that writes it, so every spec a change adds or
// edits is run many times, shuffled, under load.
describe('which specs a change burns in', () => {
  const diff = [
    'package.json',
    'src/main/git/status.ts',
    'tests/unit/main/git/status.spec.ts',
    'tests/unit/renderer/Sidebar.spec.tsx',
    'tests/e2e/foundry/order.spec.ts',
    'tests/support/test-seed.ts',
    'docs/testing.md',
  ].join('\n')

  it('keeps the unit specs, in spec.ts and spec.tsx, and drops everything else', () => {
    expect(changedSpecs(diff, { e2e: false })).toEqual([
      'tests/unit/main/git/status.spec.ts',
      'tests/unit/renderer/Sidebar.spec.tsx',
    ])
  })

  it('keeps only the end-to-end specs with --e2e', () => {
    expect(changedSpecs(diff, { e2e: true })).toEqual(['tests/e2e/foundry/order.spec.ts'])
  })

  it('finds nothing in an empty diff', () => {
    expect(changedSpecs('', { e2e: false })).toEqual([])
  })
})

describe('reading the command line', () => {
  it('defaults to 30 unit runs and 5 end-to-end runs', () => {
    expect(stabilityArguments([])).toEqual({ runs: 30, e2e: false, specs: [] })
    expect(stabilityArguments(['--e2e'])).toEqual({ runs: 5, e2e: true, specs: [] })
  })

  it('takes --runs and the named specs', () => {
    expect(stabilityArguments(['--runs', '3', 'a.spec.ts', 'b.spec.ts'])).toEqual({
      runs: 3,
      e2e: false,
      specs: ['a.spec.ts', 'b.spec.ts'],
    })
  })
})

describe('making seeds', () => {
  it('gives as many seeds as runs, none repeated', () => {
    const seeds = freshSeeds(200)
    expect(seeds).toHaveLength(200)
    expect(new Set(seeds).size).toBe(200)
  })
})

const specs = ['tests/unit/main/git/status.spec.ts']

describe('burning specs in', () => {
  it('runs once per seed, each seed once, when every run passes', async () => {
    const seen: number[] = []
    const seeds = [11, 22, 33, 44]
    const result = await burnIn({
      specs,
      runs: 4,
      seeds,
      run: async (seed: number) => {
        seen.push(seed)
        return 0
      },
    })
    expect(seen).toEqual(seeds)
    expect(result).toEqual({ code: 0, message: 'stability: 4 runs passed for 1 specs' })
  })
})

describe('burning in a failing spec', () => {
  it('stops at the first failing run and names its number and seed', async () => {
    const seen: number[] = []
    const result = await burnIn({
      specs,
      runs: 5,
      seeds: [11, 22, 33, 44, 55],
      run: async (seed: number) => {
        seen.push(seed)
        return seed === 33 ? 1 : 0
      },
    })
    expect(seen).toEqual([11, 22, 33])
    expect(result.code).toBe(1)
    expect(result.message).toBe(
      `stability: ${specs.join(' ')} failed on run 3 of 5 with TEST_SEED=33`
    )
  })
})

describe('burning in nothing', () => {
  it('passes without running anything when no spec was added or edited', async () => {
    let ran = 0
    const result = await burnIn({
      specs: [],
      runs: 30,
      seeds: [1],
      run: async () => {
        ran += 1
        return 1
      },
    })
    expect(ran).toBe(0)
    expect(result).toEqual({ code: 0, message: 'stability: no spec added or edited' })
  })
})
