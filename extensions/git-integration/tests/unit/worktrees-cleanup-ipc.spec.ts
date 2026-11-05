import { describe, it, expect } from 'vitest'
import type { ChannelSpec, ExtensionAPI } from '@terminator/extension-sdk'
import { registerWorktreesHandlers, type CleanupDeps } from '../../src/ipc/worktrees.ipc'
import type { CleanupSettings } from '../../src/git/cleanup-plan'
import { partialFake } from '../../../../tests/support/fakes'
import { bindShellToAnswers } from './support/shell'

const RULES_OFF: CleanupSettings = {
  removeAfterMerge: false,
  idleDays: 0,
  removeUnchanged: false,
  removeWithClosedSessions: false,
  keep: 'uncommitted',
}
const RULE_MERGE: CleanupSettings = { ...RULES_OFF, removeAfterMerge: true }
const NOW_UNIX = Math.floor(Date.now() / 1000)

/** for-each-ref record: branch, upstream, track, committer time, worktree path. */
const refRecord = (branch: string, path: string) => `${branch}\0\0\0${NOW_UNIX}\0${path}`

interface Setup {
  settings: CleanupSettings
  dirty?: string[]
  sessionCwd?: string
}

/** Registers the channels over a stubbed git with three branches; returns the cleanup channel and git's commands. */
function setup({ settings, dirty = [], sessionCwd }: Setup) {
  const commands: string[] = []
  bindShellToAnswers((_command, args, { cwd }) => {
    commands.push(args.join(' '))
    if (args[0] === 'symbolic-ref') return 'origin/main'
    if (args[0] === 'rev-parse') return 'main'
    if (args[0] === 'for-each-ref')
      return [
        refRecord('main', '/repo'),
        refRecord('feat/done', '/repo/.worktrees/done'),
        refRecord('feat/dirty', '/repo/.worktrees/dirty'),
      ].join('\n')
    if (args[0] === 'status') return dirty.includes(cwd) ? ' M a.ts\n' : ''
    return ''
  })
  const specs: ChannelSpec[] = []
  const api = partialFake<ExtensionAPI>({
    ipc: { invokeChannel: async () => ({ worktrees: [{ path: '/repo' }] }) } as never,
    workspace: { list: () => [], listProjects: () => [], deleteProject: () => {} } as never,
    pty: { listSessions: async () => (sessionCwd ? [{ cwd: sessionCwd }] : []) } as never,
  })
  const deps: CleanupDeps = {
    settings: () => settings,
    mergedHeads: () => ['feat/done', 'feat/dirty'],
  }
  registerWorktreesHandlers((spec) => void specs.push(spec), api, deps)
  const channel = specs.find((spec) => spec.channel === 'git:cleanup-run')!
  return { channel, commands }
}

const run = (channel: ChannelSpec) =>
  (channel as never as { run: (p: unknown) => unknown }).run({ repoRoot: '/repo' })

describe('git:cleanup-run', () => {
  it('has a schema that names repoRoot, so a missing one never runs git', () => {
    const { channel } = setup({ settings: RULES_OFF })
    expect(channel.schema.safeParse({}).success).toBe(false)
  })

  it('reads and removes nothing when every rule is off', async () => {
    const { channel, commands } = setup({ settings: RULES_OFF })
    expect(await run(channel)).toEqual({ removed: [], kept: [] })
    expect(commands).toEqual([])
  })
})

describe('git:cleanup-run — removal', () => {
  it('removes a merged head with branch -D and keeps the one with uncommitted changes', async () => {
    const { channel, commands } = setup({ settings: RULE_MERGE, dirty: ['/repo/.worktrees/dirty'] })
    const report = (await run(channel)) as {
      removed: Array<{ branch: string; reason: string }>
      kept: Array<{ branch: string; reason: string }>
    }
    expect(report.removed.map((e) => [e.branch, e.reason])).toEqual([
      ['feat/done', 'Its pull request merged'],
    ])
    expect(report.kept.map((e) => [e.branch, e.reason])).toEqual([
      ['feat/dirty', '1 uncommitted change'],
    ])
    expect(commands).toContain('worktree remove /repo/.worktrees/done')
    expect(commands).toContain('branch -D feat/done')
    expect(commands.some((c) => c.includes('worktree remove --force'))).toBe(false)
    expect(commands.some((c) => c.includes('feat/dirty') && c.startsWith('branch'))).toBe(false)
  })

  it('keeps a worktree an open terminal runs in, in plain words', async () => {
    const { channel } = setup({ settings: RULE_MERGE, sessionCwd: '/repo/.worktrees/done' })
    const report = (await run(channel)) as { kept: Array<{ branch: string; reason: string }> }
    expect(report.kept).toContainEqual(
      expect.objectContaining({ branch: 'feat/done', reason: 'An open terminal runs in it' })
    )
  })
})
