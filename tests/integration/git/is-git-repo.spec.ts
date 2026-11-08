import { describe, it, expect, afterAll } from 'vitest'
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeTempDir } from '../../support/temp-dir'

// On a fresh macOS runner the first /usr/bin/git, an xcrun shim, gave no answer in time, so a
// plain folder read as "could not read the git repository" (issue #326). The stand-in git never answers.

const bin = makeTempDir('is-git-repo-bin-')
writeFileSync(join(bin, 'git'), '#!/bin/sh\nkill -9 $$\n')
chmodSync(join(bin, 'git'), 0o755)

const originalPath = process.env.PATH
afterAll(() => {
  process.env.PATH = originalPath
})

async function loadIsGitRepo() {
  // git-service takes its environment, PATH included, when it is loaded.
  process.env.PATH = `${bin}:${originalPath}`
  return (await import('../../../src/main/git/git-service')).isGitRepo
}

describe('isGitRepo when git gives no answer', () => {
  it('says a folder with no repository in it or above it is not one', async () => {
    const isGitRepo = await loadIsGitRepo()
    const plain = join(makeTempDir('is-git-repo-plain-'), 'nested')
    mkdirSync(plain)

    await expect(isGitRepo(plain)).resolves.toBe(false)
  })

  it('still rejects for a folder inside a checkout, which only git can read', async () => {
    const isGitRepo = await loadIsGitRepo()
    const checkout = makeTempDir('is-git-repo-checkout-')
    mkdirSync(join(checkout, '.git'))
    mkdirSync(join(checkout, 'src'))

    await expect(isGitRepo(join(checkout, 'src'))).rejects.toThrow(/could not run/)
  })
})

async function loadWorkTreeRoot() {
  process.env.PATH = `${bin}:${originalPath}`
  return (await import('../../../src/main/git/git-service')).workTreeRoot
}

describe('workTreeRoot reads the checkout from the folder tree, so git need not answer', () => {
  it('names the checkout that holds a folder', async () => {
    const workTreeRoot = await loadWorkTreeRoot()
    const checkout = makeTempDir('work-tree-checkout-')
    mkdirSync(join(checkout, '.git'))
    writeFileSync(join(checkout, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    mkdirSync(join(checkout, 'src'))

    await expect(workTreeRoot(join(checkout, 'src'))).resolves.toBe(realpathSync(checkout))
  })

  it('names a linked worktree, whose .git is a file that points at its repository', async () => {
    const workTreeRoot = await loadWorkTreeRoot()
    const worktree = makeTempDir('work-tree-linked-')
    writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere/.git/worktrees/feature\n')

    await expect(workTreeRoot(worktree)).resolves.toBe(realpathSync(worktree))
  })

  it('names none for a .git folder that is not a repository, and leaves it to git', async () => {
    const workTreeRoot = await loadWorkTreeRoot()
    const checkout = makeTempDir('work-tree-empty-git-')
    mkdirSync(join(checkout, '.git'))

    await expect(workTreeRoot(checkout)).resolves.toBeNull()
  })

  it('names none inside a bare repository, which has no work tree', async () => {
    const workTreeRoot = await loadWorkTreeRoot()
    const bare = makeTempDir('work-tree-bare-')
    writeFileSync(join(bare, 'HEAD'), 'ref: refs/heads/main\n')
    mkdirSync(join(bare, 'objects'))
    mkdirSync(join(bare, 'refs'))

    await expect(workTreeRoot(bare)).resolves.toBeNull()
  })
})
