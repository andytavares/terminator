import { describe, it, expect, vi } from 'vitest'
import { commitWorktree } from '../../src/line/commit.js'
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
