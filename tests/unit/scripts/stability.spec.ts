import { describe, it, expect } from 'vitest'
import {
  burnIn,
  changedSpecs,
  e2eBurnInCommands,
  freshSeeds,
  stabilityArguments,
  stabilityShards,
  unitBurnInArguments,
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
    expect(stabilityArguments([])).toMatchObject({ runs: 30, e2e: false, list: false, specs: [] })
    expect(stabilityArguments(['--e2e'])).toMatchObject({ runs: 5, e2e: true, specs: [] })
  })

  it('takes --runs and the named specs', () => {
    expect(stabilityArguments(['--runs', '3', 'a.spec.ts', 'b.spec.ts'])).toMatchObject({
      runs: 3,
      e2e: false,
      list: false,
      specs: ['a.spec.ts', 'b.spec.ts'],
    })
  })

  it('takes --list, which names the specs without running them', () => {
    expect(stabilityArguments(['--e2e', '--list'])).toMatchObject({
      runs: 5,
      e2e: true,
      list: true,
      specs: [],
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

describe('burning in e2e specs', () => {
  it('installs Chromium first when a spec drives the browser', () => {
    expect(e2eBurnInCommands(['tests/e2e/remote-control.spec.ts'], 5)).toEqual([
      ['npx', ['playwright', 'install', 'chromium']],
      ['npx', ['playwright', 'test', 'tests/e2e/remote-control.spec.ts', '--repeat-each=5']],
    ])
  })

  it('runs only Playwright when no spec needs Chromium', () => {
    expect(e2eBurnInCommands(['tests/e2e/settings.spec.ts'], 5)).toEqual([
      ['npx', ['playwright', 'test', 'tests/e2e/settings.spec.ts', '--repeat-each=5']],
    ])
  })
})

describe('which unit specs the default Vitest run holds', () => {
  it('burns in a .spec.js unit spec, and leaves out the ones the default Vitest run excludes', () => {
    const more = [
      'tests/integration/remote/server.spec.js',
      'tests/unit/main/startup.perf.spec.ts',
      'extensions/git-integration/tests/live/pull-requests.spec.ts',
    ].join('\n')
    expect(changedSpecs(more, { e2e: false })).toEqual(['tests/integration/remote/server.spec.js'])
  })
})

describe('splitting the runs over CI runners', () => {
  it('takes --part and --github-output, and runs every spec on one runner by default', () => {
    expect(stabilityArguments(['--runs', '3', '--part', '2/4'])).toMatchObject({
      runs: 3,
      part: '2/4',
      githubOutput: false,
      specs: [],
    })
    expect(stabilityArguments(['--github-output'])).toMatchObject({
      part: '1/1',
      githubOutput: true,
    })
  })

  it('keeps a small change on one runner, with all 30 runs', () => {
    expect(stabilityShards(2, 30)).toEqual([{ shard: 1, runs: 30, part: '1/1' }])
  })

  it('splits the runs of a change too slow to run 30 times on one runner, and keeps 30 in all', () => {
    const shards = stabilityShards(96, 30)
    expect(shards.length).toBeGreaterThan(1)
    expect(shards.every((shard) => shard.part === '1/1')).toBe(true)
    expect(shards.map((shard) => shard.shard)).toEqual(shards.map((_, index) => index + 1))
    expect(shards.reduce((total, shard) => total + shard.runs, 0)).toBe(30)
  })
})

describe('splitting the specs over CI runners', () => {
  it('also splits the specs when one run of them all does not fit on one runner', () => {
    const shards = stabilityShards(884, 30)
    const parts = new Set(shards.map((shard) => shard.part))
    expect(parts).toEqual(new Set(['1/3', '2/3', '3/3']))
    for (const part of parts) {
      const runs = shards.filter((shard) => shard.part === part).map((shard) => shard.runs)
      expect(runs.reduce((total, count) => total + count, 0)).toBe(30)
    }
  })

  it('gives a change with no spec one runner, which finds nothing to run', () => {
    expect(stabilityShards(0, 30)).toEqual([{ shard: 1, runs: 30, part: '1/1' }])
  })

  it('passes a part to Vitest only when the specs are split', () => {
    expect(unitBurnInArguments(['a.spec.ts'], '1/1')).toEqual(['vitest', 'run', 'a.spec.ts'])
    expect(unitBurnInArguments(['a.spec.ts', 'b.spec.ts'], '2/3')).toEqual([
      'vitest',
      'run',
      'a.spec.ts',
      'b.spec.ts',
      '--shard=2/3',
    ])
  })
})
