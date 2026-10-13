import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'

/**
 * The function size limits `eslint.config.mjs` applies to the renderer, the
 * remote client, the extension SDK and design system, and their tests,
 * checked against the real config: at most 30 lines (blank lines and comments
 * aside), complexity 10 and three parameters. As in extension-rules.spec.ts,
 * loading the config imports typescript-eslint and the TypeScript compiler,
 * so the module loads it once, before any case runs.
 */

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
  'tests/unit/renderer/example.spec.tsx',
  'tests/unit/renderer-remote/example.spec.ts',
  'tests/unit/packages/example.spec.ts',
  'tests/unit/ConfirmDialog.spec.tsx',
]

describe('function size limits for the renderer and the packages', () => {
  it.each(COVERED)('reject a function over 30 lines in %s', async (file) => {
    expect(await sizeRulesBroken(longFunction, file)).toEqual(['max-lines-per-function'])
  })

  it.each(COVERED)('reject four parameters and complexity 11 in %s', async (file) => {
    expect(await sizeRulesBroken(fourParams, file)).toEqual(['max-params'])
    expect(await sizeRulesBroken(branchy, file)).toEqual(['complexity'])
  })
})
