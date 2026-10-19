import { describe, it, expect } from 'vitest'
import { removeLocalItems, type RemoveShell } from '../../src/git/remove-local'

interface Call {
  cwd: string
  args: string[]
}

interface FakeShellOptions {
  mainWorktree?: string
  currentBranch?: string
  projects?: Array<{ id: string; name: string; worktreePath?: string }>
  failOn?: (args: string[]) => string | null
}

/** An InventoryShell over recorded calls; git answers from `failOn`, success otherwise. */
function recordingShell(options: FakeShellOptions) {
  const calls: Call[] = []
  const deleted: string[] = []
  const shell: RemoveShell = {
    exec: async (cwd, args) => {
      calls.push({ cwd, args })
      if (args[0] === 'worktree' && args[1] === 'list')
        return `worktree ${options.mainWorktree ?? '/repo'}\nbranch refs/heads/main\n`
      if (args[0] === 'rev-parse') return options.currentBranch ?? 'main'
      const failure = options.failOn?.(args)
      if (failure) throw new Error(failure)
      return ''
    },
    listProjects: async () => options.projects ?? [],
    deleteProject: (id) => deleted.push(id),
  }
  return { shell, calls, deleted }
}

const gitArgs = (calls: Call[]) => calls.map((c) => c.args.join(' '))

describe('removeLocalItems — refusals', () => {
  it('refuses the main worktree and the current branch', async () => {
    const { shell, calls } = recordingShell({ currentBranch: 'main' })
    const { results } = await removeLocalItems('/repo', shell, [
      { branch: null, worktreePath: '/repo', forceWorktree: false, forceBranch: false },
      { branch: 'main', worktreePath: null, forceWorktree: false, forceBranch: false },
    ])
    expect(results).toEqual([
      { branch: null, worktreePath: '/repo', ok: false, reason: 'main worktree' },
      { branch: 'main', worktreePath: null, ok: false, reason: 'current branch' },
    ])
    expect(calls.filter((c) => c.args[0] === 'branch')).toEqual([])
  })
})

const removalItem = (branch: string | null, worktreePath: string | null, forceBranch = false) => ({
  branch,
  worktreePath,
  forceWorktree: false,
  forceBranch,
})

const FIX_PROJECT = [{ id: 'p1', name: 'Fix', worktreePath: '/repo/.worktrees/fix' }]

describe('removeLocalItems — removal', () => {
  it('removes the worktree, then the branch with -d for a merged one, and prunes once', async () => {
    const { shell, calls } = recordingShell({})
    const { results } = await removeLocalItems('/repo', shell, [
      removalItem('feature', '/repo/.worktrees/feature'),
      removalItem('stale', null, true),
    ])
    expect(gitArgs(calls)).toEqual([
      'worktree list --porcelain',
      'rev-parse --abbrev-ref HEAD',
      'worktree remove /repo/.worktrees/feature',
      'branch -d feature',
      'branch -D stale',
      'worktree prune',
    ])
    expect(results).toEqual([
      { branch: 'feature', worktreePath: '/repo/.worktrees/feature', ok: true },
      { branch: 'stale', worktreePath: null, ok: true },
    ])
  })
})

describe('removeLocalItems — flags and failures', () => {
  it('passes --force only when the item asks for it', async () => {
    const { shell, calls } = recordingShell({})
    await removeLocalItems('/repo', shell, [
      { ...removalItem(null, '/repo/.worktrees/dirty'), forceWorktree: true },
    ])
    expect(gitArgs(calls)).toContain('worktree remove --force /repo/.worktrees/dirty')
  })

  it('reports a failed item with git’s message and keeps going', async () => {
    const { shell, calls } = recordingShell({
      failOn: (args) => (args[1] === 'remove' ? 'fatal: is dirty' : null),
    })
    const { results } = await removeLocalItems('/repo', shell, [
      removalItem('wip', '/repo/.worktrees/wip'),
    ])
    expect(results).toEqual([
      { branch: 'wip', worktreePath: '/repo/.worktrees/wip', ok: false, reason: 'fatal: is dirty' },
    ])
    // The branch stays too: the item failed as a whole. Prune still runs.
    expect(gitArgs(calls)).toContain('worktree prune')
    expect(gitArgs(calls)).not.toContain('branch -d wip')
  })
})

describe('removeLocalItems — the project of a removed worktree', () => {
  it('deletes the Terminator project of a removed worktree', async () => {
    const { shell, deleted } = recordingShell({ projects: FIX_PROJECT })
    await removeLocalItems('/repo', shell, [removalItem(null, '/repo/.worktrees/fix')])
    expect(deleted).toEqual(['p1'])
  })

  it('keeps the project when the removal failed', async () => {
    const { shell, deleted } = recordingShell({
      projects: FIX_PROJECT,
      failOn: () => 'fatal: nope',
    })
    await removeLocalItems('/repo', shell, [removalItem(null, '/repo/.worktrees/fix')])
    expect(deleted).toEqual([])
  })
})
