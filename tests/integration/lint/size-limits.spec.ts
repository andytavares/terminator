import { describe, it, expect } from 'vitest'
import { lintCases } from './oxlint-sandbox'

/** The function size limits .oxlintrc.json applies to every file, against the real config. */

const SIZE_RULES = new Set([
  'eslint/max-lines-per-function',
  'eslint/complexity',
  'eslint/max-params',
])

async function rulesBroken(code: string, file: string): Promise<string[]> {
  return ((await lintCases([{ file, code }])).get(file) ?? []).map(({ rule }) => rule)
}

async function sizeRulesBroken(code: string, file: string): Promise<string[]> {
  return (await rulesBroken(code, file)).filter((rule) => SIZE_RULES.has(rule))
}

const longFunction = `export function long(): number {\n${Array.from(
  { length: 31 },
  (_, i) => `  const v${i} = ${i}\n`
).join('')}  return v0\n}\n`
const fourParams =
  'export const f = (a: number, b: number, c: number, d: number) => a + b + c + d\n'
const branchy = `export function branchy(n: number): number {\n${Array.from(
  { length: 10 },
  (_, i) => `  if (n === ${i}) return ${i}\n`
).join('')}  return -1\n}\n`

const COVERED = [
  'packages/core-renderer/src/components/Example.tsx',
  'packages/core-renderer-remote/src/example.ts',
  'packages/extension-sdk/src/example.ts',
  'packages/extension-ui/src/Example.tsx',
  'packages/extension-ui/stories/Example.stories.tsx',
  'packages/core-renderer/tests/unit/renderer/App.render-count.spec.tsx',
  'packages/core-renderer-remote/tests/unit/renderer-remote/App.spec.tsx',
  'packages/core-renderer/tests/unit/ConfirmDialog.spec.tsx',
  'tests/integration/foundry-portability.spec.ts',
  'tests/unit/lint/size-limits.spec.ts',
  'scripts/perf/example.mts',
  'vitest.example.config.ts',
]

describe('function size limits for every file', () => {
  it.each(COVERED)('reject a function over 30 lines in %s', async (file) => {
    expect(await sizeRulesBroken(longFunction, file)).toEqual(['eslint/max-lines-per-function'])
  })

  it.each(COVERED)('reject four parameters and complexity 11 in %s', async (file) => {
    expect(await sizeRulesBroken(fourParams, file)).toEqual(['eslint/max-params'])
    expect(await sizeRulesBroken(branchy, file)).toEqual(['eslint/complexity'])
  })
})

describe('no explicit any', () => {
  it.each(COVERED)('is an error in %s', async (file) => {
    expect(await rulesBroken('export const v: any = 1\n', file)).toContain(
      'typescript/no-explicit-any'
    )
  })
})
