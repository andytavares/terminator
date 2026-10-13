import { describe, it, expect } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'

/**
 * The rules `eslint.config.mjs` applies to extension source, checked against
 * the real config. Loading the config imports typescript-eslint, and with it
 * the TypeScript compiler: about a second of CPU, against milliseconds for
 * each lint after it. So one instance serves every case, and the module loads
 * the config as it loads, before any case runs.
 */

const repoRoot = path.resolve(__dirname, '../../..')
const eslint = new ESLint({
  cwd: repoRoot,
  overrideConfigFile: path.join(repoRoot, 'eslint.config.mjs'),
})
// The first lint of each kind of file also loads the parser and the rules it runs.
const warmUp: [string, string][] = [
  ['extensions/notepad/src/index.ts', "import { z } from 'zod'\nexport const s = z.string()\n"],
  [
    'extensions/notepad/src/View.tsx',
    'export const A = () => <p title="a">{b ? \'c\' : null}</p>\n',
  ],
]
for (const [file, code] of warmUp) {
  await eslint.lintText(code, { filePath: path.join(repoRoot, file) })
}

async function messagesOf(code: string, file: string, ruleId: string) {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) })
  return result.messages.filter((m) => m.ruleId === ruleId).map((m) => m.message)
}

/**
 * The import boundary (Constitution II, ADR 094): extension source imports
 * the SDK, the design system, npm packages and its own files, and nothing else.
 */
async function rejected(specifier: string, file: string): Promise<boolean> {
  const code = `import { value } from '${specifier}'\nexport const used = value\n`
  return (await messagesOf(code, file, 'no-restricted-imports')).length > 0
}

const rejectedCases: [string, string, string][] = [
  ['core source', '../../../src/main/extensions/api', 'extensions/notepad/src/index.ts'],
  [
    'core source from a deeper file',
    '../../../../src/main/db/index',
    'extensions/notepad/src/ipc/a.ts',
  ],
  ['another extension by path', '../../../task-vault/src/index', 'extensions/notepad/src/ipc/a.ts'],
  [
    'another extension by package',
    '@terminator/extension-task-vault',
    'extensions/notepad/src/index.ts',
  ],
  ['the extensions directory', '../../../../manifest.json', 'extensions/notepad/src/a/b/c.ts'],
]

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

describe('extension import boundary', () => {
  it.each(rejectedCases)('rejects %s', async (_name, specifier, file) => {
    expect(await rejected(specifier, file)).toBe(true)
  })
})

describe('extension import boundary — allowed', () => {
  it.each(allowedCases)('allows %s', async (_name, specifier, file) => {
    expect(await rejected(specifier, file)).toBe(false)
  })

  it('does not apply to core source', async () => {
    expect(await rejected('../../../packages/x', 'src/main/a/b.ts')).toBe(false)
  })
})

/**
 * The vocabulary rule. The "project"/"branch" rule has existed since ADR 032
 * but was scoped to `src/renderer/components/**`, which is exactly why the
 * extensions drifted: nothing was watching them. This asserts the widened
 * override fires on extension source, and — the half that matters more — that
 * it stays quiet on the identifiers, IPC channel names and imports that
 * legitimately carry the same words. A rule that cannot tell
 * `task-vault:vault:add-task` from "saved to vault" gets switched off within a week.
 */
function syntaxMessagesFor(code: string, file = 'extensions/notepad/src/components/X.tsx') {
  return messagesOf(code, file, 'no-restricted-syntax')
}

describe('extension vocabulary rule — rejects implementation words in what the reader sees', () => {
  const cases: [string, string][] = [
    ['saved to vault', 'const A = () => <span>saved to vault</span>'],
    ['a local SQLite vault', 'const A = () => <p>a local SQLite vault and export</p>'],
    ['an Artifacts tab label', "const t = [{ id: 'a', label: 'Artifacts' }]"],
    ['a Stalls heading', 'const A = () => <h3>Stalls</h3>'],
    ['stalls in prose', 'const A = () => <p>Shadow mode: stalls are recorded here.</p>'],
    ['ngrok in prose', 'const A = () => <p>ngrok not installed — public URL unavailable.</p>'],
    ['an ngrok auth token label', "const t = [{ label: 'ngrok auth token' }]"],
    ['ngrok in a tooltip', 'const A = () => <button title="Set ngrok token" />'],
    ['vault in a placeholder', 'const A = () => <input placeholder="Search the vault" />'],
    [
      'text rendered through a conditional',
      "const A = () => <div>{s ? 'stalls are recorded here' : 'ok'}</div>",
    ],
  ]

  for (const [name, code] of cases) {
    it(`rejects ${name}`, async () => {
      expect(await syntaxMessagesFor(code)).not.toHaveLength(0)
    })
  }
})

describe('extension vocabulary rule — leaves the code alone', () => {
  const cases: [string, string][] = [
    ['IPC channel names', "invoke('task-vault:vault:add-task', {})"],
    ['imports', "import { useVaultStore } from '../stores/vault.store'"],
    ['type names', 'type X = { artifacts: ArtifactRef[] }'],
    ['class names', 'const A = () => <div className="vault-cal-panel" />'],
    ['state keys', "const m = { stalled: 'not making progress' }"],
    ['the extension its own name', 'const A = () => <button title="Open in Task Vault" />'],
    [
      'a command the reader has to type verbatim',
      'const A = () => <code>brew install ngrok</code>',
    ],
    // A descendant combinator after the expression container reached through
    // `{items.map(...)}` into the className of the element built inside it,
    // so the rule flagged `vault-sidebar__item--active`. Direct child only.
    [
      'a conditional class name inside a map',
      'const A = () => <nav>{items.map((i) => (<button key={i} ' +
        'className={`x${a === i ? " vault-sidebar__item--active" : ""}`} />))}</nav>',
    ],
  ]

  for (const [name, code] of cases) {
    it(`allows ${name}`, async () => {
      expect(await syntaxMessagesFor(code)).toHaveLength(0)
    })
  }
})

describe('extension vocabulary rule', () => {
  it('does not police core source, which has its own rule', async () => {
    const msgs = await syntaxMessagesFor(
      'const A = () => <p>saved to vault</p>',
      'src/renderer/components/X.tsx'
    )
    expect(msgs).toHaveLength(0)
  })
})

/**
 * Constitution XII. Landed with the last conversion rather than before it: a
 * rule that fires 139 times on the day it ships gets switched off.
 */
describe('icon sizing rule', () => {
  it('rejects a size prop on a lucide icon', async () => {
    const msgs = await syntaxMessagesFor('const A = () => <Check size={14} />')
    expect(msgs.join(' ')).toMatch(/Constitution XII/)
  })

  it('accepts the published scale classes', async () => {
    expect(await syntaxMessagesFor('const A = () => <Check className="tm-icon" />')).toHaveLength(0)
    expect(
      await syntaxMessagesFor('const A = () => <Check className="x tm-icon-sm" />')
    ).toHaveLength(0)
  })

  it('leaves the HTML rows attribute alone', async () => {
    // <select size={6}> is how many rows a list box shows. Lowercase tag.
    expect(await syntaxMessagesFor('const A = () => <select size={6} />')).toHaveLength(0)
  })

  it('leaves a generator that genuinely takes a pixel count alone', async () => {
    // QRCodeSVG computes its module grid from this; it is not CSS-sizable.
    expect(
      await syntaxMessagesFor('const A = () => <QRCodeSVG value="x" size={112} />')
    ).toHaveLength(0)
  })

  it('does not police core source', async () => {
    const msgs = await syntaxMessagesFor(
      'const A = () => <Check size={14} />',
      'src/renderer/components/X.tsx'
    )
    expect(msgs.join(' ')).not.toMatch(/Constitution XII/)
  })
})
