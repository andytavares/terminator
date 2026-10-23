import { test, expect } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, launchApp, type AppHandle } from './helpers'
import { misalignedOn } from './control-alignment'
import { CONTRAST_PROBE, type Probe } from './contrast-probe'
import { git, openGitTab, openRepo, writeFile } from './git-harness'
import type { ExtensionView } from './extension-page'

/** MergeFlow on a real conflicted repository: the Conflict Solver writes each choice to disk,
 * undoes it and starts over, and lands a merge commit with a warning it could not be pushed.
 * Its contrast is measured here because its surfaces exist only while a repository is mid-merge. */

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

test.beforeAll(async () => {
  repo = makeConflictedRepo()
  handle = await launchApp()
  await openRepo(handle, 'Resolve Workspace', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  if (repo) rmSync(repo, { recursive: true, force: true })
})

const fileText = (file: string) => readFileSync(join(repo, file), 'utf8')

const markerCount = (file: string) =>
  fileText(file)
    .split('\n')
    .filter((l) => l.startsWith('<<<<<<<')).length

/** Conflicts left in `file`, or -1 while it is missing. Start over runs
 * `git checkout --conflict=merge`, and git's checkout removes a file before it
 * writes the new one, so a read in between finds nothing there. */
function markersAfterCheckout(file: string): number {
  try {
    return markerCount(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return -1
    throw error
  }
}

/** Reads `file` every few milliseconds, as an editor or git might while the app
 * writes it, and keeps every read that found it empty or missing. */
function watchReads(file: string): { stopWatching(): string[] } {
  const torn: string[] = []
  const timer = setInterval(() => {
    try {
      if (fileText(file) === '') torn.push('empty')
    } catch (error) {
      torn.push(String(error))
    }
  }, 2)
  return { stopWatching: () => (clearInterval(timer), torn) }
}

async function decideConflict(
  view: ExtensionView,
  choice: 'Keep mine' | 'Keep theirs'
): Promise<void> {
  await view.getByRole('button', { name: new RegExp(`^${choice}`) }).click()
  await view.getByRole('button', { name: /^Confirm/ }).click()
}

async function openFileInSolver(view: ExtensionView, file: string): Promise<void> {
  await view.getByTestId('conflict-file-row').filter({ hasText: file }).click()
  await expect(view.getByRole('button', { name: 'Keep mine' }).first()).toBeVisible()
}

async function theSolverOpensInSentenceCaseWithIcons(): Promise<void> {
  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Resolve conflicts' }).click()
  await expect(view.getByText('Merge conflicts need resolving')).toBeVisible()
  await expect(view.locator('.conflict-hub__hero')).toContainText('3')
  const text = await view.evaluate(() => document.body.innerText)
  // ConflictHub's own headings, in sentence case rather than the caps they were.
  expect(text).toMatch(/Files conflicted|Total conflicts|Needs your attention/)
  expect(text).not.toMatch(/FILES CONFLICTED|TOTAL CONFLICTS|NEEDS YOUR ATTENTION/)
  // Every glyph that used to stand for a state is a lucide icon now (Principle XII).
  expect(text).not.toMatch(/[✓✕↺▸▾]/)
}

async function setTheme(theme: 'dark' | 'light'): Promise<void> {
  await handle.page.evaluate(`(async () => {
    await window.electronAPI.settings.updateGlobal({ appearance: { theme: '${theme}' } })
    window.electronAPI.extension.setTheme('${theme}')
    document.documentElement.setAttribute('data-theme', '${theme}')
  })()`)
  await expect
    .poll(() => handle.page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(theme)
}

/** Lets colours declared with a CSS `transition` finish interpolating after a theme flip. */
const SETTLE_ANIMATIONS = `(async () => {
  for (let i = 0; i < 60; i++) {
    if (document.getAnimations().length === 0) break
    await new Promise((r) => requestAnimationFrame(r))
  }
})()`

async function meetsWcagAa(theme: 'dark' | 'light'): Promise<void> {
  const view = await openGitTab(handle)
  await setTheme(theme)
  // A theme reaches the frame as a later message. Dark is the absence of the attribute: the
  // frame shim removes it rather than setting 'dark'.
  await expect
    .poll(() => view.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(theme === 'light' ? 'light' : null)
  await view.evaluate(SETTLE_ANIMATIONS)
  const probes = (await view.evaluate(CONTRAST_PROBE)) as Probe[]
  expect(probes.length, 'MergeFlow rendered no text to measure').toBeGreaterThan(0)
  const failures = probes.filter((p) => p.ratio < p.required)
  const report = failures
    .map((f) => `  ${f.ratio}:1 (needs ${f.required}) ${f.selector} — "${f.text}"`)
    .join('\n')
  expect(failures, `git-integration / MergeFlow / ${theme}:\n${report}`).toHaveLength(0)
}

async function aDecisionIsWrittenAndUndone(): Promise<void> {
  const view = await openGitTab(handle)
  const misaligned = await misalignedOn(view, 'Conflict hub')
  await openFileInSolver(view, 'app.ts')
  misaligned.push(...(await misalignedOn(view, 'Conflict in app.ts')))
  expect(misaligned).toEqual([])

  const inode = statSync(join(repo, 'app.ts')).ino
  const reads = watchReads('app.ts')
  await decideConflict(view, 'Keep mine')
  await expect.poll(() => markerCount('app.ts')).toBe(1)
  expect(fileText('app.ts')).toContain('export const greeting = "good day"')
  // A new file renamed over the old one. Checked after this one write: after a second rename
  // the freed inode number can come back.
  expect(statSync(join(repo, 'app.ts')).ino).not.toBe(inode)

  await view.getByRole('button', { name: 'Undo last decision' }).click()
  await expect.poll(() => markerCount('app.ts')).toBe(2)
  // Replaced by rename each time, so no reader ever caught it half written.
  expect(reads.stopWatching()).toEqual([])
}

async function startOverRestoresEveryMarker(): Promise<void> {
  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Back to file list' }).click()
  await openFileInSolver(view, 'app.ts')
  await decideConflict(view, 'Keep mine')
  await expect.poll(() => markerCount('app.ts')).toBe(1)
  await decideConflict(view, 'Keep theirs')
  await expect.poll(() => markerCount('app.ts')).toBe(0)
  expect(fileText('app.ts')).toContain('export const count = 2')

  await view.getByRole('button', { name: 'Start over' }).click()
  await expect.poll(() => markersAfterCheckout('app.ts')).toBe(2)
  await expect(view.getByText('Merge conflicts need resolving')).toBeVisible()
  await expect(view.locator('.conflict-hub__file-card--resolved')).toHaveCount(0)
}

async function resolvingEverythingCommitsTheMerge(): Promise<void> {
  const view = await openGitTab(handle)
  await openFileInSolver(view, 'app.ts')
  await decideConflict(view, 'Keep mine')
  await decideConflict(view, 'Keep theirs')
  await decideConflict(view, 'Keep theirs')
  await expect(view.getByText('All conflicts resolved')).toBeVisible()
  await view.getByRole('button', { name: 'Commit merge' }).click()

  // The Git view draws its own toast: the core's would sit under the view.
  await expect(
    view.locator('.tmui-toast__message', { hasText: 'Committed but push failed' })
  ).toBeVisible()
  expect(git(repo, 'rev-list', '--parents', '-n', '1', 'HEAD').split(' ')).toHaveLength(3)
  expect(git(repo, 'status', '--porcelain')).toBe('')
  expect(fileText('app.ts')).toBe(appSource('good day', 2))
  expect(fileText('config.ts')).toBe('export const retries = 3\n')
  await expect(view.getByRole('button', { name: 'Commit', exact: true })).toBeVisible()
}

test('a merge conflict is resolved in the Conflict Solver and committed', async () => {
  const steps: Array<[string, () => Promise<void>]> = [
    [
      'MergeFlow opens on a real conflict, in sentence case and with icons for states',
      theSolverOpensInSentenceCaseWithIcons,
    ],
    ['MergeFlow meets WCAG AA in the dark theme', () => meetsWcagAa('dark')],
    ['MergeFlow meets WCAG AA in the light theme', () => meetsWcagAa('light')],
    [
      'a decision is written to the file, and undo puts the conflict back',
      aDecisionIsWrittenAndUndone,
    ],
    [
      'Start over restores every conflict marker once a file is fully decided',
      startOverRestoresEveryMarker,
    ],
    [
      'resolving every conflict commits the merge, and the failed push is reported',
      resolvingEverythingCommitsTheMerge,
    ],
  ]
  for (const [title, run] of steps) await test.step(title, run)
})
