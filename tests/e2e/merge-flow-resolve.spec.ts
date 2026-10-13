import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, launchApp, type AppHandle } from './helpers'
import { git, openGitTab, openRepo, writeFile } from './git-harness'

/**
 * Resolving a merge in the Conflict Solver, decision by decision, against a
 * real conflicted repository: each choice is written to the file on disk,
 * undo puts the markers back, Start over restores every conflict, and the
 * merge commit lands with a warning that it could not be pushed.
 */

let handle: AppHandle
let repo: string

const FILLER = Array.from({ length: 8 }, (_, i) => `export const filler${i} = ${i}`).join('\n')

function appSource(greeting: string, count: number): string {
  return `export const greeting = "${greeting}"\n${FILLER}\nexport const count = ${count}\n`
}

/** main and feature both change two far-apart lines of app.ts and one of config.ts. */
function makeConflictedRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'terminator-e2e-resolve-'))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'config', 'user.name', 'E2E')
  writeFile(dir, 'app.ts', appSource('hello', 1))
  writeFile(dir, 'config.ts', 'export const retries = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', 'initial')
  git(dir, 'checkout', '--quiet', '-b', 'feature')
  writeFile(dir, 'app.ts', appSource('hi there', 2))
  writeFile(dir, 'config.ts', 'export const retries = 3\n')
  git(dir, 'commit', '-am', 'feature: reword and recount')
  git(dir, 'checkout', '--quiet', 'main')
  writeFile(dir, 'app.ts', appSource('good day', 5))
  writeFile(dir, 'config.ts', 'export const retries = 5\n')
  git(dir, 'commit', '-am', 'main: reword and recount')
  try {
    git(dir, 'merge', 'feature')
  } catch {
    // The conflict is the point of the fixture.
  }
  return dir
}

const fileText = (file: string) => readFileSync(join(repo, file), 'utf8')

const markerCount = (file: string) =>
  fileText(file)
    .split('\n')
    .filter((l) => l.startsWith('<<<<<<<')).length

/**
 * Conflicts left in `file`, or -1 while it is missing. Start over runs
 * `git checkout --conflict=merge`, and git's checkout removes a file before it
 * writes the new one, so a read in between finds nothing there.
 */
function markersAfterCheckout(file: string): number {
  try {
    return markerCount(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return -1
    throw error
  }
}

/**
 * Reads `file` every few milliseconds, as an editor or git might while the app
 * writes it, and keeps every read that found it empty or missing.
 */
function watchReads(file: string): { stop(): string[] } {
  const torn: string[] = []
  const timer = setInterval(() => {
    try {
      if (fileText(file) === '') torn.push('empty')
    } catch (error) {
      torn.push(String(error))
    }
  }, 2)
  return { stop: () => (clearInterval(timer), torn) }
}

async function openSolver(): Promise<Page> {
  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Resolve conflicts' }).click()
  await expect(view.getByText('Merge conflicts need resolving')).toBeVisible({ timeout: 15000 })
  return view
}

async function decide(view: Page, choice: 'Keep mine' | 'Keep theirs'): Promise<void> {
  await view.getByRole('button', { name: new RegExp(`^${choice}`) }).click()
  await view.getByRole('button', { name: /^Confirm/ }).click()
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  repo = makeConflictedRepo()
  handle = await launchApp()
  await openRepo(handle, 'Resolve Workspace', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  if (repo) rmSync(repo, { recursive: true, force: true })
})

test('a decision is written to the file, and undo puts the conflict back', async () => {
  const view = await openSolver()
  await expect(view.locator('.conflict-hub__hero')).toContainText('3')
  await view.getByTestId('conflict-file-row').filter({ hasText: 'app.ts' }).click()

  const inode = statSync(join(repo, 'app.ts')).ino
  const reads = watchReads('app.ts')
  await decide(view, 'Keep mine')
  await expect.poll(() => markerCount('app.ts')).toBe(1)
  expect(fileText('app.ts')).toContain('export const greeting = "good day"')
  // A new file renamed over the old one. Checked after this one write: the
  // replacement was created while the original still held its inode, so the
  // two differ; after a second rename the freed number can come back.
  expect(statSync(join(repo, 'app.ts')).ino).not.toBe(inode)

  await view.getByRole('button', { name: 'Undo last decision' }).click()
  await expect.poll(() => markerCount('app.ts')).toBe(2)
  // Replaced by rename each time, so no reader ever caught it half written.
  expect(reads.stop()).toEqual([])
})

test('Start over restores every conflict marker once a file is fully decided', async () => {
  const view = await gitViewWithResolver()
  await decide(view, 'Keep mine')
  await expect.poll(() => markerCount('app.ts')).toBe(1)
  await decide(view, 'Keep theirs')
  await expect.poll(() => markerCount('app.ts')).toBe(0)
  expect(fileText('app.ts')).toContain('export const count = 2')

  await view.getByRole('button', { name: 'Start over' }).click()
  await expect.poll(() => markersAfterCheckout('app.ts')).toBe(2)
  await expect(view.getByText('Merge conflicts need resolving')).toBeVisible()
  await expect(view.locator('.conflict-hub__file-card--resolved')).toHaveCount(0)
})

/** The solver is still open from the previous test; go back to its file list and into app.ts. */
async function gitViewWithResolver(): Promise<Page> {
  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Back to file list' }).click()
  await view.getByTestId('conflict-file-row').filter({ hasText: 'app.ts' }).click()
  return view
}

test('resolving every conflict commits the merge, and the failed push is reported', async () => {
  const view = await openGitTab(handle)
  await view.getByTestId('conflict-file-row').filter({ hasText: 'app.ts' }).click()
  await decide(view, 'Keep mine')
  await decide(view, 'Keep theirs')
  await decide(view, 'Keep theirs')

  await expect(view.getByText('All conflicts resolved')).toBeVisible()
  await view.getByRole('button', { name: 'Commit merge' }).click()

  await expect(
    handle.page.locator('.tmui-toast__message', { hasText: 'Committed but push failed' })
  ).toBeVisible({ timeout: 15000 })
  expect(git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3)
  expect(git(repo, 'status', '--porcelain')).toBe('')
  expect(readFileSync(join(repo, 'app.ts'), 'utf8')).toBe(appSource('good day', 2))
  expect(readFileSync(join(repo, 'config.ts'), 'utf8')).toBe('export const retries = 3\n')
  await expect(view.getByRole('button', { name: 'Commit', exact: true })).toBeVisible()
})
