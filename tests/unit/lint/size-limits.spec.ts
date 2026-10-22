import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'

/** The function size limits `eslint.config.mjs` applies to every file, against the real
 * config, loaded once as in extension-rules.spec.ts. */

const repoRoot = path.resolve(__dirname, '../../..')
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
})
// The first lint of each kind of file also loads the parser and the rules it runs.
for (const file of ['src/renderer/warm-up.ts', 'src/renderer/WarmUp.tsx']) {
  await eslint.lintText('export const a = 1\n', { filePath: path.join(repoRoot, file) })
}

const SIZE_RULES = new Set(['max-lines-per-function', 'complexity', 'max-params'])

async function sizeRulesBroken(code: string, file: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) })
  return result.messages.flatMap((m) => (m.ruleId && SIZE_RULES.has(m.ruleId) ? [m.ruleId] : []))
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
  'src/renderer/components/Example.tsx',
  'src/renderer-remote/example.ts',
  'packages/extension-sdk/src/example.ts',
  'packages/extension-ui/src/Example.tsx',
  'packages/extension-ui/stories/Example.stories.tsx',
  // Specs are linted with type information, so each is a spec a test project includes.
  'tests/unit/renderer/App.render-count.spec.tsx',
  'tests/unit/renderer-remote/App.spec.tsx',
  'tests/unit/ConfirmDialog.spec.tsx',
  'tests/integration/foundry-portability.spec.ts',
  'tests/unit/lint/size-limits.spec.ts',
  'scripts/perf/example.mts',
  'vitest.example.config.ts',
]

describe('function size limits for every file', () => {
  it.each(COVERED)('reject a function over 30 lines in %s', async (file) => {
    expect(await sizeRulesBroken(longFunction, file)).toEqual(['max-lines-per-function'])
  })

  it.each(COVERED)('reject four parameters and complexity 11 in %s', async (file) => {
    expect(await sizeRulesBroken(fourParams, file)).toEqual(['max-params'])
    expect(await sizeRulesBroken(branchy, file)).toEqual(['complexity'])
  })
})

describe('no explicit any', () => {
  it.each(COVERED)('is an error in %s', async (file) => {
    const [result] = await eslint.lintText('export const v: any = 1\n', {
      filePath: path.join(repoRoot, file),
    })
    const anyRule = result.messages.find((m) => m.ruleId === '@typescript-eslint/no-explicit-any')
    expect(anyRule?.severity).toBe(2)
  })
})
