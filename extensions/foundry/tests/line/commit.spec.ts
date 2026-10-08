import { describe, it, expect, vi } from 'vitest'
import { commitWorktree, committedSince } from '../../src/line/commit.js'
import type { ShellExec } from '../../src/line/integrate.js'

// A format step that writes leaves the checkout ahead of what CI will see, and
// the push that follows is only honest when a commit was actually made.

function exec(responses: Record<string, { exitCode: number; stdout?: string }>) {
  const calls: string[][] = []
  const run = vi.fn(async (options: { args: string[] }) => {
    calls.push(options.args)
    const found = responses[options.args[0]] ?? { exitCode: 0 }
    return { exitCode: found.exitCode, stdout: found.stdout ?? '', stderr: '', timedOut: false }
  })
  return { run: run as unknown as ShellExec, calls }
}

describe('commitWorktree', () => {
  it('commits what is dirty and says so', async () => {
    const { run, calls } = exec({ status: { exitCode: 0, stdout: ' M src/a.ts\n' } })
    expect(await commitWorktree('/work', 'final check: format', run)).toBe(true)
    expect(calls).toEqual([
      ['status', '--porcelain'],
      ['add', '-A'],
      ['commit', '-m', 'final check: format'],
    ])
  })

  it('makes no commit for a clean tree', async () => {
    const { run, calls } = exec({ status: { exitCode: 0, stdout: '' } })
    expect(await commitWorktree('/work', 'm', run)).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('reports false when git could not stage or commit, so nothing is pushed as if it had', async () => {
    const staged = exec({ status: { exitCode: 0, stdout: 'M a' }, add: { exitCode: 1 } })
    expect(await commitWorktree('/work', 'm', staged.run)).toBe(false)
    const committed = exec({ status: { exitCode: 0, stdout: 'M a' }, commit: { exitCode: 1 } })
    expect(await commitWorktree('/work', 'm', committed.run)).toBe(false)
    const unreadable = exec({ status: { exitCode: 128 } })
    expect(await commitWorktree('/work', 'm', unreadable.run)).toBe(false)
  })
})

// A builder that commits its own work leaves a clean tree; that is a change,
// and reading it as "made no change" halted WO-1008-6fe on finished work.
describe('committedSince', () => {
  const started = '2026-10-08T00:33:55.960Z'

  it('counts a commit made after the step started', async () => {
    const { run, calls } = exec({ log: { exitCode: 0, stdout: '1791420115\n' } })
    expect(await committedSince('/work', started, run)).toBe(true)
    expect(calls).toEqual([['log', '-1', '--format=%ct']])
  })

  it('does not count the commit the checkout started on', async () => {
    const { run } = exec({ log: { exitCode: 0, stdout: '1791419000\n' } })
    expect(await committedSince('/work', started, run)).toBe(false)
  })

  it('counts a commit in the same second the step started', async () => {
    const { run } = exec({ log: { exitCode: 0, stdout: '1791419635\n' } })
    expect(await committedSince('/work', started, run)).toBe(true)
  })

  it('reports false when git cannot read the head', async () => {
    const { run } = exec({ log: { exitCode: 128, stdout: '' } })
    expect(await committedSince('/work', started, run)).toBe(false)
  })
})
