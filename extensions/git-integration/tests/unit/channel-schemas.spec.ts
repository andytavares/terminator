import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { realpathSync, rmSync } from 'node:fs'
import { dispatchChannel } from '@terminator/extension-sdk'
import { makeTempDir } from '../../../../tests/support/temp-dir'

vi.mock('electron-store', () => ({
  default: class {
    store = {}
    get() {
      return undefined
    }
    set() {}
    delete() {}
  },
}))

import { activateCapturingChannels } from './support/activate'

// ADR 096: whether a channel rejects bad input is its schema's job, so this
// checks once, for every channel git-integration registers, that one is declared.
describe('every git-integration channel', () => {
  it('declares a schema that keeps a malformed payload from reaching run', async () => {
    const specs = activateCapturingChannels().channels.map((c) => c.spec)

    expect(specs.map((spec) => spec.channel)).toContain('git:commit')
    expect(new Set(specs.map((spec) => spec.channel)).size).toBe(specs.length)
    for (const spec of specs) {
      expect(spec.schema, `${spec.channel} has no schema`).toBeDefined()
      const run = vi.fn()
      await dispatchChannel({ ...spec, run }, 42)
      expect(run, `${spec.channel} ran a malformed payload`).not.toHaveBeenCalled()
    }
  })
})

/** Each rule: a payload the channel takes, and the same payload broken in one field. */
const RULE_CASES: Array<[string, string, Record<string, unknown>, Record<string, unknown>]> = [
  ['stages at least one path', 'git:stage', { paths: ['a.ts'] }, { paths: [] }],
  [
    'resolves a conflict with a known strategy',
    'git:resolve-conflict',
    { blockId: 'src/foo.ts#0', resolvedText: 'x', strategy: 'ours' },
    { blockId: 'src/foo.ts#0', resolvedText: 'x', strategy: 'bad-strategy' },
  ],
  [
    'adds a comment with a body',
    'github:pr-issue-comment-add',
    { prNumber: 6, body: 'looks good' },
    { prNumber: 6, body: '' },
  ],
  [
    'submits a review with an event GitHub knows',
    'github:pr-review-submit',
    { prNumber: 42, event: 'COMMENT', body: '' },
    { prNumber: 42, event: 'MERGE', body: '' },
  ],
  [
    'resolves a block inside the repository, not one reached through ..',
    'git:resolve-conflict',
    { blockId: 'src/foo.ts#0', resolvedText: 'x', strategy: 'ours' },
    { blockId: '../../outside.ts#0', resolvedText: 'x', strategy: 'ours' },
  ],
  [
    'resolves a block inside the repository, not one at an absolute path',
    'git:resolve-conflict',
    { blockId: 'src/foo.ts#0', resolvedText: 'x', strategy: 'ours' },
    { blockId: '/etc/hosts#0', resolvedText: 'x', strategy: 'ours' },
  ],
  [
    'undoes a block inside the repository only',
    'git:undo-resolve',
    { blockId: 'src/foo.ts#0', resolvedText: 'x', originalConflictText: 'y' },
    { blockId: 'src/../../outside.ts#0', resolvedText: 'x', originalConflictText: 'y' },
  ],
  [
    'names a pull request by a positive number',
    'github:remove-active-review',
    { prNumber: 3 },
    { prNumber: -1 },
  ],
]

// The table above proves each channel has a schema; these are the rules it carries: each payload
// is valid apart from one field, and the valid one must reach run, so the refusal is the rule's
// and not the repoRoot confinement's.
describe('the rules the channel schemas carry', () => {
  let repo: string
  beforeAll(() => {
    repo = realpathSync(makeTempDir('gi-rules-'))
  })
  afterAll(() => rmSync(repo, { recursive: true, force: true }))

  for (const [rule, channel, valid, broken] of RULE_CASES) {
    it(`${rule} (${channel})`, () => checkRule(repo, channel, { valid, broken }))
  }
})

/** The valid payload reaches the channel's run; the broken one is refused before it. */
async function checkRule(
  repo: string,
  channel: string,
  payloads: { valid: Record<string, unknown>; broken: Record<string, unknown> }
) {
  const { valid, broken } = payloads
  const specs = activateCapturingChannels({ folderPath: repo, worktreePaths: [repo] }).channels
  const spec = specs.find((c) => c.spec.channel === channel)?.spec
  if (spec === undefined) throw new Error(`no channel ${channel}`)

  const accepted = vi.fn()
  await dispatchChannel({ ...spec, run: accepted }, { repoRoot: repo, ...valid })
  expect(accepted, 'the valid payload was refused').toHaveBeenCalledOnce()

  const refused = vi.fn()
  await dispatchChannel({ ...spec, run: refused }, { repoRoot: repo, ...broken })
  expect(refused, 'the broken payload ran').not.toHaveBeenCalled()
}
