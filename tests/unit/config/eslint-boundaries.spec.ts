import { describe, it, expect, beforeAll } from 'vitest'
import { ESLint } from 'eslint'
import { readdirSync, readFileSync } from 'fs'
import { resolve, join, dirname, relative, sep } from 'path'

// The two boundaries this feature depends on are enforced by lint, not by
// convention, because a convention that is not enforced decays. These tests
// lint fixture source text through the real project config, so they fail if the
// rule is deleted, renamed, or mis-scoped — not merely if the JSON shape drifts.

const REPO_ROOT = resolve(__dirname, '../../..')

let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({ cwd: REPO_ROOT })
})

async function messagesFor(code: string, filePath: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath: resolve(REPO_ROOT, filePath) })
  return results.flatMap((r) => r.messages).map((m) => `${m.ruleId}: ${m.message}`)
}

function hasRestrictedImport(messages: string[]): boolean {
  return messages.some((m) => m.startsWith('no-restricted-imports:'))
}

describe('agent-runtime seam (FR-002 to FR-004, SC-007)', () => {
  const sdkImport =
    "import { query } from '@anthropic-ai/claude-agent-sdk'\nexport const q = query\n"

  it('rejects an SDK import from main-process code outside the seam', async () => {
    const messages = await messagesFor(sdkImport, 'src/main/supervision/state/state-machine.ts')
    expect(hasRestrictedImport(messages)).toBe(true)
  })

  it('rejects an SDK import from the renderer', async () => {
    const messages = await messagesFor(sdkImport, 'src/renderer/stores/supervision.store.ts')
    expect(hasRestrictedImport(messages)).toBe(true)
  })

  it('rejects an SDK subpath import outside the seam', async () => {
    const messages = await messagesFor(
      "import type { Thing } from '@anthropic-ai/claude-agent-sdk/types'\nexport type T = Thing\n",
      'src/main/supervision/stall/evaluate-stall.ts'
    )
    expect(hasRestrictedImport(messages)).toBe(true)
  })

  it('allows an SDK import inside the seam', async () => {
    const messages = await messagesFor(sdkImport, 'src/main/supervision/agent-runtime/driver.ts')
    expect(hasRestrictedImport(messages)).toBe(false)
  })
})

describe('core/extension boundary (FR-065, SC-011)', () => {
  // Enforced by resolving every relative import in src/** and checking whether
  // it lands inside the repo-root extensions/ workspace. A glob cannot do this
  // job: src/main/extensions/ and src/renderer/extensions/ are the extension
  // *host* — core plumbing — and a pattern broad enough to catch the real
  // violation flags all fourteen of those files too. Resolving the path is
  // exact, and needs no new dependency to be so.

  const EXTENSIONS_ROOT = resolve(REPO_ROOT, 'extensions')
  const SRC_ROOT = resolve(REPO_ROOT, 'src')

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return sourceFiles(full)
      return /\.tsx?$/.test(entry.name) ? [full] : []
    })
  }

  function relativeImports(file: string): string[] {
    const source = readFileSync(file, 'utf-8')
    const specifiers = [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1])
    return specifiers
  }

  function importsIntoExtensions(file: string): string[] {
    return relativeImports(file).filter((specifier) => {
      const target = resolve(dirname(file), specifier)
      return target === EXTENSIONS_ROOT || target.startsWith(EXTENSIONS_ROOT + sep)
    })
  }

  it('no file under src/ imports anything from the extensions workspace', () => {
    const offenders = sourceFiles(SRC_ROOT)
      .map((file) => ({ file: relative(REPO_ROOT, file), specifiers: importsIntoExtensions(file) }))
      .filter((r) => r.specifiers.length > 0)

    expect(offenders).toEqual([])
  })

  it('the check actually resolves paths, rather than matching on the word "extensions"', () => {
    // src/main/extensions/api.ts is core. If this test ever starts flagging it,
    // the check has regressed into the glob it replaced.
    const hostFile = resolve(SRC_ROOT, 'main/ipc/extension.ipc.ts')
    expect(importsIntoExtensions(hostFile)).toEqual([])
  })
})

describe('the rules do not over-reach', () => {
  it('leaves ordinary core imports alone', async () => {
    const messages = await messagesFor(
      "import { z } from 'zod'\nimport { handleChannel } from './channel-registrar.js'\nexport const x = { z, handleChannel }\n",
      'src/main/ipc/supervision.ipc.ts'
    )
    expect(hasRestrictedImport(messages)).toBe(false)
  })

  it('does not restrict extension source itself', async () => {
    const messages = await messagesFor(
      "import { z } from 'zod'\nexport const s = z.string()\n",
      'extensions/git-integration/src/index.ts'
    )
    expect(hasRestrictedImport(messages)).toBe(false)
  })
})
