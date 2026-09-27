import { describe, it, expect } from 'vitest'
import {
  testsFromReport,
  isParallelFile,
  units,
  pack,
  timingsFromReport,
} from '../../../scripts/e2e-shard.mjs'

const result = (ms: number) => ({ results: [{ duration: ms }] })

const REPORT = {
  suites: [
    {
      title: 'session-home.spec.ts',
      file: 'session-home.spec.ts',
      specs: [
        {
          title: 'the app opens on Home',
          file: 'session-home.spec.ts',
          line: 40,
          tests: [result(6000)],
        },
      ],
      suites: [
        {
          title: 'the Ledger',
          file: 'session-home.spec.ts',
          specs: [
            {
              title: 'fits its surface',
              file: 'session-home.spec.ts',
              line: 90,
              tests: [result(8000)],
            },
          ],
        },
      ],
    },
    {
      title: 'terminal.spec.ts',
      file: 'terminal.spec.ts',
      specs: [{ title: 'types', file: 'terminal.spec.ts', line: 10, tests: [{ results: [] }] }],
    },
  ],
}

describe('testsFromReport', () => {
  it('keys each test by its file and describe titles, and reads its duration', () => {
    expect(testsFromReport(REPORT)).toEqual([
      {
        file: 'session-home.spec.ts',
        line: 40,
        key: 'session-home.spec.ts › the app opens on Home',
        seconds: 6,
      },
      {
        file: 'session-home.spec.ts',
        line: 90,
        key: 'session-home.spec.ts › the Ledger › fits its surface',
        seconds: 8,
      },
      { file: 'terminal.spec.ts', line: 10, key: 'terminal.spec.ts › types', seconds: null },
    ])
  })

  it('records only tests that ran', () => {
    expect(timingsFromReport(REPORT)).toEqual({
      'session-home.spec.ts › the app opens on Home': 6,
      'session-home.spec.ts › the Ledger › fits its surface': 8,
    })
  })
})

describe('isParallelFile', () => {
  it('is true only for a file-level parallel configure', () => {
    expect(isParallelFile("import x\ntest.describe.configure({ mode: 'parallel' })\n")).toBe(true)
    expect(isParallelFile("  test.describe.configure({ mode: 'parallel' })\n")).toBe(false)
    expect(isParallelFile("test.describe.configure({ mode: 'serial' })\n")).toBe(false)
  })
})

describe('units', () => {
  const tests = testsFromReport(REPORT)

  it('splits a parallel file per test and keeps any other file whole', () => {
    const timings = {
      'session-home.spec.ts › the app opens on Home': 6,
      'session-home.spec.ts › the Ledger › fits its surface': 8,
    }
    expect(units(tests, new Set(['session-home.spec.ts']), timings)).toEqual([
      { args: ['tests/e2e/session-home.spec.ts:40'], seconds: 6 },
      { args: ['tests/e2e/session-home.spec.ts:90'], seconds: 8 },
      // Never timed, so it costs the median of what was.
      { args: ['tests/e2e/terminal.spec.ts'], seconds: 8 },
    ])
    expect(units(tests, new Set(), timings)).toEqual([
      { args: ['tests/e2e/session-home.spec.ts'], seconds: 14 },
      { args: ['tests/e2e/terminal.spec.ts'], seconds: 8 },
    ])
  })
})

describe('pack', () => {
  // The shape that made one shard run 106s: slow tests adjacent in file order,
  // among many fast ones.
  const heavy = Array.from({ length: 10 }, (_, i) => ({
    args: [`tests/e2e/s.spec.ts:${i}`],
    seconds: 9,
  }))
  const light = Array.from({ length: 40 }, (_, i) => ({
    args: [`tests/e2e/l${i}.spec.ts`],
    seconds: 1,
  }))
  const all = [...light.slice(0, 20), ...heavy, ...light.slice(20)]

  it('places every unit exactly once', () => {
    const placed = pack(all, 5).flatMap((bin) => bin.args)
    expect(placed.sort()).toEqual(all.map((u) => u.args[0]).sort())
  })

  it('spreads adjacent slow tests so no shard carries much more than its share', () => {
    const loads = pack(all, 5).map((bin) => bin.seconds)
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(9)
    expect(Math.max(...loads)).toBeLessThanOrEqual((10 * 9 + 40) / 5 + 9)
  })

  it('gives every shard job the same plan whatever order the tests were listed in', () => {
    expect(pack([...all].reverse(), 5)).toEqual(pack(all, 5))
  })

  it('leaves a shard empty rather than inventing work when there is too little', () => {
    const bins = pack(heavy.slice(0, 2), 5)
    expect(bins.filter((bin) => bin.args.length === 0)).toHaveLength(3)
  })
})
