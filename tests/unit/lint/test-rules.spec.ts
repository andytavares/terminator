import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'

/** The rules `eslint.config.mjs` applies to specs (ADR 123): a test waits on a signal, never on
 * a tick, a delay or a time limit of its own, and never leaves a promise running. */

const repoRoot = path.resolve(__dirname, '../../..')
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
})
// Typed rules need a file the test projects include; the text linted is the case's own.
const UNIT_SPEC = 'tests/unit/lint/test-rules.spec.ts'
const E2E_SPEC = 'tests/e2e/app-menu.spec.ts'

async function rulesHit(code: string, file = UNIT_SPEC): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) })
  return result.messages.map((m) => m.ruleId ?? m.message)
}

const PRELUDE = "import { it, vi, expect } from 'vitest'\ndeclare function stop(): Promise<void>\n"

const rejected: [string, string, string][] = [
  [
    'one setImmediate tick',
    "it('a', async () => { await new Promise((r) => setImmediate(r)) })",
    'no-restricted-syntax',
  ],
  [
    'a bare setImmediate',
    "it('a', async () => { await new Promise(setImmediate) })",
    'no-restricted-syntax',
  ],
  [
    'process.nextTick',
    "it('a', async () => { await new Promise((r) => process.nextTick(r)) })",
    'no-restricted-syntax',
  ],
  [
    'queueMicrotask',
    "it('a', async () => { await new Promise((r) => queueMicrotask(r)) })",
    'no-restricted-syntax',
  ],
  [
    'an empty Promise.resolve',
    "it('a', async () => { await Promise.resolve() })",
    'no-restricted-syntax',
  ],
  ['a test time limit', "it('a', () => { expect(1).toBe(1) }, 20_000)", 'no-restricted-syntax'],
  [
    'a test options time limit',
    "it('a', { timeout: 20_000 }, () => { expect(1).toBe(1) })",
    'no-restricted-syntax',
  ],
  [
    'a test time limit by name',
    "const LIMIT = 5000\nit('a', () => { expect(1).toBe(1) }, LIMIT)",
    'no-restricted-syntax',
  ],
  [
    'a hook time limit by name',
    'const LIMIT = 5000\nbeforeEach(() => undefined, LIMIT)',
    'no-restricted-syntax',
  ],
  ['vi.setConfig', "it('a', () => { vi.setConfig({ testTimeout: 1 }) })", 'no-restricted-syntax'],
  [
    'vi.waitFor and its one-second default',
    "it('a', async () => { await vi.waitFor(() => expect(1).toBe(1)) })",
    'no-restricted-syntax',
  ],
  [
    'a stop that is not awaited',
    "it('a', () => { stop() })",
    '@typescript-eslint/no-floating-promises',
  ],
  [
    'a stop discarded with void',
    "it('a', () => { void stop() })",
    '@typescript-eslint/no-floating-promises',
  ],
  [
    'an expect.poll not awaited',
    "it('a', () => { expect.poll(() => 1).toBe(1) })",
    'vitest/require-awaited-expect-poll',
  ],
]

describe('a spec waits on signals only', () => {
  it.each(rejected)('rejects %s', async (_name, body, rule) => {
    expect(await rulesHit(PRELUDE + body + '\n')).toContain(rule)
  })

  it('accepts awaiting what the code under test returns', async () => {
    const body =
      "it('a', async () => { await stop(); expect(vi.isMockFunction(stop)).toBe(false) })\n"
    expect(await rulesHit(PRELUDE + body)).toEqual([])
  })
})

describe('an e2e spec waits on the page', () => {
  const E2E_PRELUDE = "import { test, expect } from '@playwright/test'\n"
  const cases: [string, string, string][] = [
    [
      'a locator time limit',
      "test('a', async ({ page }) => { await expect(page.getByRole('button')).toBeVisible({ timeout: 5000 }) })",
      'no-restricted-syntax',
    ],
    [
      'test.setTimeout',
      "test('a', async () => { test.setTimeout(60_000) })",
      'no-restricted-syntax',
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
  ]
  it.each(cases)('rejects %s', async (_name, body, rule) => {
    expect(await rulesHit(E2E_PRELUDE + body + '\n', E2E_SPEC)).toContain(rule)
  })
})
