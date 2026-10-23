import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, launchApp, projectGroup, type AppHandle } from './helpers'
import { git, makeRepoWithRemote, openGitTab, openRepo, writeFile } from './git-harness'
import type { ExtensionView } from './extension-page'

/** The Git tab follows its repository through the file watch: nothing here is done in the app,
 * and the tab has no timer to notice it with. Each change is made again on every look, because
 * macOS arms a watch a moment after it starts and a change made before that has no event. */

/** Untracked before the app starts, so staging one later changes only git's own files. */
const PREPARED = Array.from({ length: 30 }, (_unused, index) => `prepared-${index}.txt`)

let handle: AppHandle
const directories: string[] = []

/** A checkout the app opens, and the branch its sidebar row is found by. */
interface Checkout {
  path: string
  branch: string
}

function ownCheckout(): Checkout {
  const { repo, bare } = makeRepoWithRemote('terminator-e2e-watch')
  directories.push(repo, bare)
  git(repo, 'branch', '-m', 'watched')
  return { path: repo, branch: 'watched' }
}

/** A linked worktree, whose index lives in the main checkout's .git, outside it. */
function linkedWorktree(): Checkout {
  const { repo, bare } = makeRepoWithRemote('terminator-e2e-watch-main')
  const worktree = join(mkdtempSync(join(tmpdir(), 'terminator-e2e-linked-')), 'linked')
  directories.push(repo, bare, worktree)
  git(repo, 'worktree', 'add', '--quiet', '-b', 'linked', worktree)
  return { path: worktree, branch: 'linked' }
}

let own: Checkout
let linked: Checkout

test.beforeAll(async () => {
  own = ownCheckout()
  linked = linkedWorktree()
  for (const file of PREPARED) {
    writeFile(own.path, file, 'prepared\n')
    writeFile(linked.path, file, 'prepared\n')
  }
  handle = await launchApp()
  await openRepo(handle, 'Watched', own.path)
  await openRepo(handle, 'Linked', linked.path)
})

test.afterAll(async () => {
  await closeApp(handle)
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
})

const stagedHeading = (view: ExtensionView) => view.getByText(/^Staged \(\d+\)/).first()

async function gitTabOf(checkout: Checkout): Promise<ExtensionView> {
  await projectGroup(handle.page, checkout.branch).click()
  const view = await openGitTab(handle)
  // The first status is read once the watch has started: the clocks below time a change, not
  // the view starting up, which a cold CI runner can take two seconds over.
  await expect(view.getByText(PREPARED[0], { exact: true }).first()).toBeAttached()
  return view
}

async function aSavedFileAppears(checkout: Checkout): Promise<void> {
  const view = await gitTabOf(checkout)
  let saves = 0
  const saveAndCount = () => {
    writeFile(checkout.path, 'saved-outside.txt', `save ${++saves}\n`)
    return view.getByText('saved-outside.txt').count()
  }
  await expect.poll(saveAndCount).toBeGreaterThan(0)
}

async function gitAddMovesAFileToStaged(checkout: Checkout): Promise<void> {
  const view = await gitTabOf(checkout)
  await expect(stagedHeading(view)).toHaveText(/^Staged \(0\)/)
  let next = 0
  const stageAnotherAndRead = () => {
    git(checkout.path, 'add', PREPARED[next++])
    return stagedHeading(view).textContent()
  }
  await expect.poll(stageAnotherAndRead).toMatch(/^Staged \([1-9]/)
}

async function gitCommitEmptiesStaged(checkout: Checkout): Promise<void> {
  const view = await gitTabOf(checkout)
  const commitAndRead = () => {
    git(checkout.path, 'commit', '--quiet', '--allow-empty', '-m', 'committed outside')
    return stagedHeading(view).textContent()
  }
  await expect.poll(commitAndRead).toMatch(/^Staged \(0\)/)
}

test('the Git tab follows a file saved, staged and committed outside the app', async () => {
  const checkouts: Array<[Checkout, string]> = [
    [own, 'a repository’s own checkout'],
    [linked, 'a linked worktree, whose index is outside it'],
  ]
  for (const [checkout, where] of checkouts) {
    await test.step(`a file saved outside the app appears in the list, on ${where}`, () =>
      aSavedFileAppears(checkout))
    await test.step(`git add in a terminal moves a file to Staged, on ${where}`, () =>
      gitAddMovesAFileToStaged(checkout))
    await test.step(`git commit in a terminal empties Staged, on ${where}`, () =>
      gitCommitEmptiesStaged(checkout))
  }
})
