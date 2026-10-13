import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { projectForCheckout } from '../../src/review/terminal-project'

// "Continue in terminal" opens the agent's session in the branch whose checkout is reviewed. The
// view names it by the workspace's folder, a project by git's real top level; on macOS temp and
// home sit behind symlinks (/var -> /private/var), so the strings differ for one directory.

/** One workspace at `folderPath` holding `projects`. */
const workspaceOf = (
  projects: Array<{ id: string; worktreePath?: string }>,
  folderPath: string
) => ({
  list: () => [{ id: 'ws', folderPath }],
  listProjects: () => projects,
})

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

  const workspace = (projects: Array<{ id: string; worktreePath?: string }>) =>
    workspaceOf(projects, link)

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
    const api = workspace([{ id: 'main', worktreePath: real }])
    expect(projectForCheckout(api, other)).toBeUndefined()
  })
})
