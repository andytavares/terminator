import { describe, it, expect, beforeAll } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'

/**
 * The import boundary (Constitution II, ADR 094), checked against the real
 * `eslint.config.mjs`: extension source imports the SDK, the design system,
 * npm packages and its own files, and nothing else.
 */

const repoRoot = path.resolve(__dirname, '../../..')
let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
  })
})

async function rejected(specifier: string, file: string): Promise<boolean> {
  const code = `import { value } from '${specifier}'\nexport const used = value\n`
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) })
  return result.messages.some((m) => m.ruleId === 'no-restricted-imports')
}

describe('extension import boundary', () => {
  const rejectedCases: [string, string, string][] = [
    ['core source', '../../../src/main/extensions/api', 'extensions/notepad/src/index.ts'],
    [
      'core source from a deeper file',
      '../../../../src/main/db/index',
      'extensions/notepad/src/ipc/a.ts',
    ],
    [
      'another extension by path',
      '../../../task-vault/src/index',
      'extensions/notepad/src/ipc/a.ts',
    ],
    [
      'another extension by package',
      '@terminator/extension-task-vault',
      'extensions/notepad/src/index.ts',
    ],
    ['the extensions directory', '../../../../manifest.json', 'extensions/notepad/src/a/b/c.ts'],
  ]
  it.each(rejectedCases)('rejects %s', async (_name, specifier, file) => {
    expect(await rejected(specifier, file)).toBe(true)
  })

  const allowedCases: [string, string, string][] = [
    ['the SDK', '@terminator/extension-sdk', 'extensions/notepad/src/index.ts'],
    ['an SDK subpath', '@terminator/extension-sdk/renderer', 'extensions/notepad/src/a/b.tsx'],
    [
      'a design system subpath',
      '@terminator/extension-ui/extension-base-css',
      'extensions/notepad/src/index.ts',
    ],
    ['an npm package', 'zod', 'extensions/notepad/src/index.ts'],
    ['its own manifest', '../manifest.json', 'extensions/notepad/src/index.ts'],
    ['its own source from a deep file', '../../../index', 'extensions/notepad/src/a/b/c.ts'],
  ]
  it.each(allowedCases)('allows %s', async (_name, specifier, file) => {
    expect(await rejected(specifier, file)).toBe(false)
  })

  it('does not apply to core source', async () => {
    expect(await rejected('../../../packages/x', 'src/main/a/b.ts')).toBe(false)
  })
})
