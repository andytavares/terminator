import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Specs run real git in a temporary directory. Run from inside a git hook, the
// hook's GIT_DIR and GIT_INDEX_FILE were inherited by every one of them, so
// `git init`, `git config` and `git commit` in a fixture wrote into the real
// repository: user.name=Test in its config and fixture commits on its branch.

describe('the environment a spec runs git in', () => {
  it('carries none of the variables that point git at a repository', () => {
    // Git's own list, so a variable git adds later is covered too.
    const local = execFileSync('git', ['rev-parse', '--local-env-vars'], { cwd: tmpdir() })
      .toString()
      .split('\n')
      .filter((name) => name !== '')
    expect(local.length).toBeGreaterThan(0)
    expect(local.filter((name) => process.env[name] !== undefined)).toEqual([])
  })

  it('initialises a fixture in the fixture, not in a repository outside it', () => {
    const fixture = mkdtempSync(join(tmpdir(), 'git-env-fixture-'))
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fixture })
      const gitDir = spawnSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: fixture })
      expect(realpathSync(gitDir.stdout.toString().trim())).toBe(
        realpathSync(join(fixture, '.git'))
      )
    } finally {
      rmSync(fixture, { recursive: true, force: true })
    }
  })
})
