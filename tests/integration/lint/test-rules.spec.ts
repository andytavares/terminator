import { describe, it, expect } from 'vitest'
import { lintCases, type LintCase } from './oxlint-sandbox'

/** The rules .oxlintrc.json applies to specs (ADR 123): a test waits on a signal, never on
 * a tick, a delay or a time limit of its own, and never leaves a promise running. */

const PRELUDE = "import { it, vi, expect } from 'vitest'\ndeclare function stop(): Promise<void>\n"

const rejected: [string, string, string][] = [
  [
    'one setImmediate tick',
    "it('a', async () => { await new Promise((r) => setImmediate(r)) })",
    'terminator/restricted-syntax',
  ],
  [
    'a bare setImmediate',
    "it('a', async () => { await new Promise(setImmediate) })",
    'terminator/restricted-syntax',
  ],
  [
    'process.nextTick',
    "it('a', async () => { await new Promise((r) => process.nextTick(r)) })",
    'terminator/restricted-syntax',
  ],
  [
    'queueMicrotask',
    "it('a', async () => { await new Promise((r) => queueMicrotask(r)) })",
    'terminator/restricted-syntax',
  ],
  [
    'an empty Promise.resolve',
    "it('a', async () => { await Promise.resolve() })",
    'terminator/restricted-syntax',
  ],
  [
    'a test time limit',
    "it('a', () => { expect(1).toBe(1) }, 20_000)",
    'terminator/restricted-syntax',
  ],
  [
    'a test options time limit',
    "it('a', { timeout: 20_000 }, () => { expect(1).toBe(1) })",
    'terminator/restricted-syntax',
  ],
  [
    'a test time limit by name',
    "const LIMIT = 5000\nit('a', () => { expect(1).toBe(1) }, LIMIT)",
    'terminator/restricted-syntax',
  ],
  [
    'a hook time limit by name',
    'const LIMIT = 5000\nbeforeEach(() => undefined, LIMIT)',
    'terminator/restricted-syntax',
  ],
  [
    'vi.setConfig',
    "it('a', () => { vi.setConfig({ testTimeout: 1 }) })",
    'terminator/restricted-syntax',
  ],
  [
    'vi.waitFor and its one-second default',
    "it('a', async () => { await vi.waitFor(() => expect(1).toBe(1)) })",
    'terminator/restricted-syntax',
  ],
  ['a stop that is not awaited', "it('a', () => { stop() })", 'typescript/no-floating-promises'],
  [
    'a stop discarded with void',
    "it('a', () => { void stop() })",
    'typescript/no-floating-promises',
  ],
  [
    'an expect.poll not awaited',
    "it('a', () => { expect.poll(() => 1).toBe(1) })",
    'vitest/require-awaited-expect-poll',
  ],
  [
    'a branch in the test body',
    "it('a', () => { if (vi) { expect(1).toBe(1) } })",
    'terminator/restricted-syntax',
  ],
]

const E2E_PRELUDE = "import { test, expect } from '@playwright/test'\n"
const e2eRejected: [string, string, string][] = [
  [
    'a locator time limit',
    "test('a', async ({ page }) => { await expect(page.getByRole('button')).toBeVisible({ timeout: 5000 }) })",
    'terminator/restricted-syntax',
  ],
  [
    'test.setTimeout',
    "test('a', async () => { test.setTimeout(60_000) })",
    'terminator/restricted-syntax',
  ],
  [
    'a one-shot visibility read',
    "test('a', async ({ page }) => { expect(await page.getByRole('button').isVisible()).toBe(true) })",
    'playwright/prefer-web-first-assertions',
  ],
  [
    'waitForSelector',
    "test('a', async ({ page }) => { await page.waitForSelector('.a') })",
    'playwright/no-wait-for-selector',
  ],
  [
    'a branch in the test body',
    "test('a', async ({ page }) => { if (page) await expect(page).toHaveTitle('a') })",
    'playwright/no-conditional-in-test',
  ],
]

const ACCEPTED =
  "it('a', async () => { await stop(); expect(vi.isMockFunction(stop)).toBe(false) })\n"

// Each case in its own spec file, at a path the spec and e2e rules cover.
const unitCase = (index: number) => `tests/unit/lint-case/case-${index}.spec.ts`
const e2eCase = (index: number) => `tests/e2e/lint-case-${index}.spec.ts`
const cases: LintCase[] = [
  ...rejected.map(([, body], index) => ({ file: unitCase(index), code: PRELUDE + body + '\n' })),
  ...e2eRejected.map(([, body], index) => ({
    file: e2eCase(index),
    code: E2E_PRELUDE + body + '\n',
  })),
  { file: 'tests/unit/lint-case/accepted.spec.ts', code: PRELUDE + ACCEPTED },
]
const findings = await lintCases(cases)
const rulesHit = (file: string) => (findings.get(file) ?? []).map(({ rule }) => rule)

const unitRows = rejected.map(([name, , rule], index) => ({ name, rule, file: unitCase(index) }))
const e2eRows = e2eRejected.map(([name, , rule], index) => ({ name, rule, file: e2eCase(index) }))

describe('a spec waits on signals only', () => {
  it.each(unitRows)('rejects $name', ({ rule, file }) => {
    expect(rulesHit(file)).toContain(rule)
  })

  it('accepts awaiting what the code under test returns', () => {
    expect(rulesHit('tests/unit/lint-case/accepted.spec.ts')).toEqual([])
  })
})

describe('an e2e spec waits on the page', () => {
  it.each(e2eRows)('rejects $name', ({ rule, file }) => {
    expect(rulesHit(file)).toContain(rule)
  })
})
