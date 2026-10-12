import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { projectForCheckout } from '../../src/review/terminal-project'

// "Continue in terminal" opens the review agent's session in the branch whose
// checkout the review is of. The view names that checkout by the workspace's
// folder; a project records git's top level, which is the real path. On macOS
// the temporary and home folders sit behind symlinks (/var -> /private/var),
// so the two strings differ for the same directory.

describe('projectForCheckout', () => {
  let dir: string
  let real: string
  let link: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'terminal-project-'))
    real = join(dir, 'widgets')
    mkdirSync(real)
    link = join(dir, 'widgets-link')
    symlinkSync(real, link)
  })

  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const workspace = (
    projects: Array<{ id: string; worktreePath?: string }>,
    folderPath = link
  ) => ({
    list: () => [{ id: 'ws', folderPath }],
    listProjects: () => projects,
  })

  it("finds the branch whose checkout is the review's, through a symlink", () => {
    const api = workspace([{ id: 'main', worktreePath: realpathSync(real) }])
    expect(projectForCheckout(api, link)).toBe('main')
  })

  it("finds a branch that records no worktree path by its workspace's folder", () => {
    expect(projectForCheckout(workspace([{ id: 'main' }]), realpathSync(real))).toBe('main')
  })

  it('finds nothing for a checkout no branch has', () => {
    const other = join(dir, 'other')
    mkdirSync(other)
    expect(
      projectForCheckout(workspace([{ id: 'main', worktreePath: real }]), other)
    ).toBeUndefined()
  })
})
