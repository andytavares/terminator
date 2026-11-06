import { describe, it, expect } from 'vitest'
import { autoPullDefault } from '../../src/git/auto-pull'
import { bindShellToAnswers } from './support/shell'
import { runGit } from '../../src/shell/run-git'

interface Repo {
  checkedOut: boolean
  dirty?: boolean
  localCommits?: number
}

/** Runs autoPullDefault against a stubbed git for `repo`; returns the outcome and the commands run. */
async function pull(repo: Repo) {
  const commands: string[] = []
  bindShellToAnswers((_command, args, { cwd }) => {
    commands.push(`${cwd}: ${args.join(' ')}`)
    if (args[0] === 'symbolic-ref') return 'origin/main\n'
    if (args[0] === 'worktree')
      return repo.checkedOut
        ? 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n'
        : 'worktree /repo\nHEAD abc\ndetached\n'
    if (args[0] === 'status') return repo.dirty ? ' M a.ts\n' : ''
    if (args[0] === 'rev-list') return `${repo.localCommits ?? 0}\n`
    return ''
  })
  const outcome = await autoPullDefault((cwd, args) => runGit(cwd, args), '/repo')
  return { outcome, commands }
}

describe('autoPullDefault', () => {
  it('fast-forwards a clean checkout with no local commits', async () => {
    const { outcome, commands } = await pull({ checkedOut: true })
    expect(outcome).toBe('merged')
    expect(commands).toContain('/repo: merge --ff-only origin/main')
  })

  it('fetches into the branch when no worktree has it checked out', async () => {
    const { outcome, commands } = await pull({ checkedOut: false })
    expect(outcome).toBe('fetched')
    expect(commands).toContain('/repo: fetch origin main:main')
  })

  it.each([{ dirty: true }, { localCommits: 2 }])('skips a checkout that is %o', async (state) => {
    const { outcome, commands } = await pull({ checkedOut: true, ...state })
    expect(outcome).toBe('skipped')
    expect(commands.some((c) => c.includes('merge'))).toBe(false)
  })
})
