import { describe, it, expect } from 'vitest'
import { lintRuns, lintConcurrency, runAll } from '../../../scripts/lint.mjs'

// Typed lint holds a TypeScript program per project; one process for the whole repository held
// all of them (4.8 GB) and CI's 7 GB runner swapped for eight minutes. One process per group.
describe('the lint runs', () => {
  const runs = lintRuns(['foundry', 'notepad'])

  it('lints each group of test projects in a process of its own', () => {
    expect(runs.slice(0, -1)).toEqual([
      ['tests'],
      ['src'],
      ['packages'],
      ['extensions/foundry'],
      ['extensions/notepad'],
    ])
  })

  it('lints everything else last, leaving out only what a group already linted', () => {
    expect(runs.at(-1)).toEqual([
      '.',
      ...['tests', 'src', 'packages', 'extensions/foundry', 'extensions/notepad'].flatMap(
        (group) => ['--ignore-pattern', `${group}/**`]
      ),
    ])
  })
})

const GB = 2 ** 30

describe('how many lint processes run at once', () => {
  it('runs a core each, 4 GB each, and no more than 3', () => {
    expect(lintConcurrency({ cores: 4, memory: 16 * GB })).toBe(3)
    expect(lintConcurrency({ cores: 2, memory: 16 * GB })).toBe(2)
    expect(lintConcurrency({ cores: 8, memory: 7 * GB })).toBe(1)
    expect(lintConcurrency({ cores: 8, memory: 8 * GB })).toBe(2)
    expect(lintConcurrency({ cores: 4, memory: 4 * GB })).toBe(1)
    expect(lintConcurrency({ cores: 1, memory: 1 * GB })).toBe(1)
  })
})

const GROUPS = [['a'], ['b'], ['c'], ['d'], ['e']]

// Each fake run stays open until the test releases it, so the test sees how many are open.
function fakeSpawn(statusOf: (run: string[]) => number) {
  const seen = { running: 0, peak: 0, started: [] as string[][] }
  const releases: Array<() => void> = []
  const spawnRun = async (run: string[]) => {
    seen.started.push(run)
    seen.running += 1
    seen.peak = Math.max(seen.peak, seen.running)
    await new Promise<void>((resolve) => releases.push(resolve))
    seen.running -= 1
    return statusOf(run)
  }
  async function runAllReleasing(limit: number) {
    const done = runAll(GROUPS, spawnRun, limit)
    for (let released = 0; released < GROUPS.length; released += 1) {
      await expect.poll(() => releases.length).toBeGreaterThan(0)
      releases.shift()?.()
    }
    return done
  }
  return { seen, runAllReleasing }
}

describe('running every lint group', () => {
  it('never runs more than the limit at once, and runs every group', async () => {
    const { seen, runAllReleasing } = fakeSpawn(() => 0)
    expect(await runAllReleasing(2)).toBe(0)
    expect(seen.peak).toBe(2)
    expect(seen.started).toHaveLength(5)
  })

  it('exits 1 when one group fails, after running the others', async () => {
    const { seen, runAllReleasing } = fakeSpawn((run) => (run[0] === 'b' ? 1 : 0))
    expect(await runAllReleasing(3)).toBe(1)
    expect(seen.started).toHaveLength(5)
  })
})
