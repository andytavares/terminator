import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, launchApp, type AppHandle } from './helpers'
import { git, makeRepoWithRemote, openGitTab, openRepo, writeFile } from './git-harness'

/** The Git tab follows its repository through the file watch: nothing here is done in the app,
 * and the tab has no timer to notice it with. Each change is made again on every look, because
 * macOS arms a watch a moment after it starts and a change made before that has no event. */

/** Untracked before the app starts, so staging one later changes only git's own files. */
const PREPARED = Array.from({ length: 30 }, (_unused, index) => `prepared-${index}.txt`)

function linkedWorktreeOf(repo: string): string {
  const worktree = join(mkdtempSync(join(tmpdir(), 'terminator-e2e-linked-')), 'linked')
  git(repo, 'worktree', 'add', '--quiet', '-b', 'linked', worktree)
  return worktree
}

const stagedHeading = (view: Page) => view.getByText(/^Staged \(\d+\)/).first()

/** The app with one checkout open, filled in before the first test of its group runs. */
class OpenCheckout {
  handle!: AppHandle
  checkout = ''
}

function openCheckoutOnce(checkoutOf: (repo: string) => string): OpenCheckout {
  const open = new OpenCheckout()
  let directories: string[] = []
  test.beforeAll(async () => {
    const { repo, bare } = makeRepoWithRemote('terminator-e2e-watch')
    open.checkout = checkoutOf(repo)
    directories = [repo, bare, open.checkout]
    for (const file of PREPARED) writeFile(open.checkout, file, 'prepared\n')
    open.handle = await launchApp()
    await openRepo(open.handle, 'Watched', open.checkout)
  })
  test.afterAll(async () => {
    await closeApp(open.handle)
    for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  })
  return open
}

function aSavedFileAppears(open: OpenCheckout): void {
  test('a file saved outside the app appears in the list', async () => {
    const view = await openGitTab(open.handle)
    // The first status is read once the watch has started: the clock below times a change, not
    // the view starting up, which a cold CI runner can take two seconds over.
    const opened = Date.now()
    await expect(view.getByText(PREPARED[0], { exact: true }).first()).toBeAttached()
    const shown = Date.now()
    test.info().annotations.push({ type: 'first status', description: `${shown - opened}ms` })
    let saves = 0
    const saveAndCount = () => {
      writeFile(open.checkout, 'saved-outside.txt', `save ${++saves}\n`)
      return view.getByText('saved-outside.txt').count()
    }
    // Sooner than the three seconds the tab used to poll at.
    await expect.poll(saveAndCount, { timeout: 2500 }).toBeGreaterThan(0)
    test.info().annotations.push({ type: 'change shown', description: `${Date.now() - shown}ms` })
  })
}

function gitAddMovesAFileToStaged(open: OpenCheckout): void {
  test('git add in a terminal moves a file to Staged', async () => {
    const view = await openGitTab(open.handle)
    await expect(stagedHeading(view)).toHaveText(/^Staged \(0\)/)
    let next = 0
    const stageAnotherAndRead = () => {
      git(open.checkout, 'add', PREPARED[next++])
      return stagedHeading(view).textContent()
    }
    await expect.poll(stageAnotherAndRead).toMatch(/^Staged \([1-9]/)
  })
}

function gitCommitEmptiesStaged(open: OpenCheckout): void {
  test('git commit in a terminal empties Staged', async () => {
    const view = await openGitTab(open.handle)
    const commitAndRead = () => {
      git(open.checkout, 'commit', '--quiet', '--allow-empty', '-m', 'committed outside')
      return stagedHeading(view).textContent()
    }
    await expect.poll(commitAndRead).toMatch(/^Staged \(0\)/)
  })
}

const CHECKOUTS: Array<[string, (repo: string) => string]> = [
  ['a repository’s own checkout', (repo) => repo],
  ['a linked worktree, whose index is outside it', linkedWorktreeOf],
]

for (const [title, checkoutOf] of CHECKOUTS) {
  test.describe(`the Git tab on ${title}`, () => {
    test.describe.configure({ mode: 'serial' })
    const open = openCheckoutOnce(checkoutOf)
    aSavedFileAppears(open)
    gitAddMovesAFileToStaged(open)
    gitCommitEmptiesStaged(open)
  })
}
