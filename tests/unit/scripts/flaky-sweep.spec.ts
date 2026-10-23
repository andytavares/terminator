import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  classify,
  issueFor,
  matchingIssue,
  renderTable,
  resultsOf,
} from '../../../scripts/flaky-sweep.mjs'

const fixtures = join(__dirname, '../../fixtures/flaky-sweep')
const load = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8'))
const vitestRuns = [load('vitest-run-1.json'), load('vitest-run-2.json')]
const playwrightRuns = [load('playwright-run-1.json'), load('playwright-run-2.json')]

const FLAKY_VITEST =
  'extensions/foundry/tests/components/App.spec.tsx > the Factory view toggle > a shaping order > sends a shaping order back to the list, open'

describe('classify', () => {
  it('calls a Vitest test that passed in one run and failed in another flaky', () => {
    const { flaky } = classify(vitestRuns)
    expect(flaky).toEqual([{ test: FLAKY_VITEST, passed: 1, failed: 1 }])
  })

  it('calls a test that failed in every run broken, and one that always passed neither', () => {
    const { flaky, broken } = classify(vitestRuns)
    expect(broken.map((entry: { test: string }) => entry.test)).toEqual([
      'extensions/foundry/tests/components/App.spec.tsx > the Factory view toggle > always fails',
    ])
    const names = [...flaky, ...broken].map((entry: { test: string }) => entry.test).join('\n')
    expect(names).not.toContain('always passes')
  })
})

describe('classify across reporters', () => {
  it('ignores skipped and pending results', () => {
    const { flaky, broken } = classify([...vitestRuns, ...playwrightRuns])
    const names = [...flaky, ...broken].map((entry: { test: string }) => entry.test).join('\n')
    expect(names).not.toContain('is skipped')
    expect(names).not.toContain('skipped one')
  })

  it('names a flaky Playwright test from the repository, whatever runner path wrote the report', () => {
    const { flaky } = classify(playwrightRuns)
    expect(flaky).toEqual([
      { test: 'tests/e2e/settings.spec.ts > Settings > saves a theme', passed: 1, failed: 1 },
    ])
  })

  it('makes an absolute Vitest file name relative to the repo root', () => {
    const report = {
      testResults: [
        {
          name: '/repo/tests/a.spec.ts',
          assertionResults: [{ ancestorTitles: [], title: 'x', status: 'failed' }],
        },
      ],
    }
    expect(classify([report], '/repo').broken[0].test).toBe('tests/a.spec.ts > x')
  })
})

describe('renderTable', () => {
  it('lists each flaky and broken test with its passes and failures', () => {
    const table = renderTable(classify(vitestRuns))
    expect(table).toContain(`| ${FLAKY_VITEST} | 1 | 1 |`)
    expect(table).toContain('always fails | 0 | 2 |')
  })

  it('says so when nothing disagrees', () => {
    expect(renderTable({ flaky: [], broken: [] })).toBe('No flaky or broken tests.\n')
  })
})

describe('issueFor', () => {
  it('titles the issue after the test and links the run in the body', () => {
    const { title, body } = issueFor(
      { test: 'tests/e2e/settings.spec.ts > Settings > saves a theme', passed: 2, failed: 1 },
      'https://github.com/o/r/actions/runs/9'
    )
    expect(title).toBe('Flaky: tests/e2e/settings.spec.ts > Settings > saves a theme')
    expect(body).toContain('https://github.com/o/r/actions/runs/9')
    expect(body).toContain('Passed in 2 run(s) and failed in 1')
  })
})

describe('issueFor limits', () => {
  it('keeps the title within the 256 characters GitHub allows', () => {
    const { title } = issueFor(
      { test: `tests/a.spec.ts > ${'x'.repeat(300)}`, passed: 1, failed: 1 },
      ''
    )
    expect(title).toHaveLength(256)
  })
})

describe('matchingIssue', () => {
  it('takes the open issue whose title is exactly the test, not one that only starts with it', () => {
    const open = [
      { number: 7, title: 'Flaky: tests/a.spec.ts > saves a theme twice' },
      { number: 8, title: 'Flaky: tests/a.spec.ts > saves a theme' },
    ]
    expect(matchingIssue(open, 'Flaky: tests/a.spec.ts > saves a theme')).toBe(8)
  })

  it('finds none when no title is exactly the test', () => {
    const open = [{ number: 7, title: 'Flaky: tests/a.spec.ts > saves a theme twice' }]
    expect(matchingIssue(open, 'Flaky: tests/a.spec.ts > saves a theme')).toBeUndefined()
  })
})

describe('resultsOf', () => {
  it('keeps a Playwright title that holds a path as written', () => {
    const report = {
      config: { configFile: '/repo/playwright.config.ts', rootDir: '/repo/tests/e2e' },
      suites: [
        {
          title: 'a.spec.ts',
          file: 'a.spec.ts',
          specs: [
            {
              title: 'opens //tmp/../x',
              file: 'a.spec.ts',
              tests: [{ results: [{ status: 'passed' }] }],
            },
          ],
        },
      ],
    }
    expect(resultsOf(report, '/repo')).toEqual([
      { test: 'tests/e2e/a.spec.ts > opens //tmp/../x', status: 'passed' },
    ])
  })
})
