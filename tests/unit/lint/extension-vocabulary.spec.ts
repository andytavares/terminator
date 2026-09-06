import { describe, it, expect, beforeAll } from 'vitest'
import { ESLint } from 'eslint'
import path from 'node:path'

/**
 * The vocabulary rule, checked against the real `.eslintrc.json`.
 *
 * The "project"/"branch" rule has existed since ADR 032 but was scoped to
 * `src/renderer/components/**`, which is exactly why the extensions drifted:
 * nothing was watching them. This asserts the widened override actually fires
 * on extension source, and — the half that matters more — that it stays quiet
 * on the identifiers, IPC channel names and imports that legitimately carry
 * the same words. A rule that cannot tell `task-vault:vault:add-task` from
 * "saved to vault" gets switched off within a week.
 */

const repoRoot = path.resolve(__dirname, '../../..')
let eslint: ESLint

beforeAll(() => {
  eslint = new ESLint({
    cwd: repoRoot,
    useEslintrc: false,
    overrideConfigFile: path.join(repoRoot, '.eslintrc.json'),
  })
})

async function messagesFor(code: string, file = 'extensions/notepad/src/components/X.tsx') {
  const [result] = await eslint.lintText(code, { filePath: path.join(repoRoot, file) })
  return result.messages.filter((m) => m.ruleId === 'no-restricted-syntax').map((m) => m.message)
}

describe('extension vocabulary rule', () => {
  describe('rejects implementation words in what the reader sees', () => {
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
        expect(await messagesFor(code)).not.toHaveLength(0)
      })
    }
  })

  describe('leaves the code alone', () => {
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
        expect(await messagesFor(code)).toHaveLength(0)
      })
    }
  })

  it('does not police core source, which has its own rule', async () => {
    const msgs = await messagesFor(
      'const A = () => <p>saved to vault</p>',
      'src/renderer/components/X.tsx'
    )
    expect(msgs).toHaveLength(0)
  })
})
