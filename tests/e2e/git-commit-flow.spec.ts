import { test, expect } from '@playwright/test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeApp, launchApp, type AppHandle } from './helpers'
import { misalignedOn } from './control-alignment'
import type { ExtensionView } from './extension-page'
import {
  git,
  gitView,
  makeRepoWithRemote,
  openGitTab,
  openRepo,
  projectTab,
  writeFile,
} from './git-harness'
import { startGithubStub, type GithubStub } from './github-stub'
import { expectCentredInWindow } from './modal-centre'

/** The Git tab on a feature branch: diff, stage, commit through a pre-commit hook (passing
 * and failing), push, open a pull request on the stub GitHub, and the Git Quick Actions. */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string
const BRANCH = 'feat/greeting'

/** Plain git pre-commit hooks, no hook manager: progress lines, then an exit status. */
const PASSING_HOOK =
  '#!/bin/sh\necho "lint: checking staged files"\nsleep 1\necho "lint: clean"\nsleep 1\n'
const FAILING_HOOK = '#!/bin/sh\necho "lint: src/greeting.ts has a problem"\nexit 1\n'

function installPreCommitHook(script: string): void {
  writeFile(repo, '.git/hooks/pre-commit', script)
  chmodSync(join(repo, '.git/hooks/pre-commit'), 0o755)
}

function fileRow(view: ExtensionView, path: string) {
  return view.locator('.staging-area__file-row').filter({ hasText: path })
}

function gitViewSection(view: ExtensionView, title: RegExp) {
  return view.locator('.staging-area__section').filter({ hasText: title })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-commit'))
  git(repo, 'checkout', '--quiet', '-b', BRANCH)
  git(repo, 'push', '--quiet', '-u', 'origin', BRANCH)
  writeFile(repo, '.github/pull_request_template.md', '## What changed\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'add a pull request template')
  git(repo, 'push', '--quiet')
  writeFile(repo, 'src/greeting.ts', 'export const greeting = "hello"\n')
  writeFile(repo, 'src/math.ts', 'export function add(a: number, b: number) {\n  return b + a\n}\n')
  stub = await startGithubStub({ bareRepo: bare })
  handle = await launchApp(undefined, stub.env)
  await openRepo(handle, 'Commit Flow', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of [repo, bare]) if (dir) rmSync(dir, { recursive: true, force: true })
})

test('selecting a changed file shows its diff', async () => {
  const view = await openGitTab(handle)
  await fileRow(view, 'src/math.ts').click()
  await expect(view.locator('.diff-line--add')).toContainText('return b + a')
  await expect(view.locator('.diff-line--remove')).toContainText('return a + b')
  expect(await misalignedOn(view, 'Git tab')).toEqual([])
})

test('checking a file stages it, unchecking unstages it, and the index agrees', async () => {
  const view = await openGitTab(handle)
  await fileRow(view, 'src/greeting.ts').locator('input[type=checkbox]').click()
  await expect(gitViewSection(view, /^Staged \(1\)/)).toContainText('src/greeting.ts')
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('src/greeting.ts')

  await fileRow(view, 'src/greeting.ts').locator('input[type=checkbox]').click()
  await expect(gitViewSection(view, /^Changes \(2\)/)).toContainText('src/greeting.ts')
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')

  await view.getByRole('button', { name: 'Stage All' }).click()
  await expect(gitViewSection(view, /^Staged \(2\)/)).toBeVisible()
  await view.getByRole('button', { name: 'Unstage All' }).click()
  await expect(gitViewSection(view, /^Staged \(0\)/)).toBeVisible()
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')
})

test('a failing pre-commit hook is reported with its output, and can be bypassed', async () => {
  installPreCommitHook(FAILING_HOOK)
  const view = await openGitTab(handle)
  await fileRow(view, 'src/greeting.ts').locator('input[type=checkbox]').click()
  await expect(gitViewSection(view, /^Staged \(1\)/)).toContainText('src/greeting.ts')
  await view.getByPlaceholder('Commit message…').fill('Add a greeting')
  await view.getByRole('button', { name: 'Commit', exact: true }).click()

  await expect(view.locator('.git-view__commit-error-msg')).toHaveText('Pre-commit hooks failed.')
  await view.getByText('Hook output').click()
  await expect(view.locator('.git-view__hook-output-pre')).toContainText('has a problem')
  expect(git(repo, 'log', '-1', '--format=%s')).toBe('add a pull request template')

  await view.getByRole('button', { name: 'Commit without hooks' }).click()
  await expect(view.locator('.git-view__commit-error')).toBeHidden()
  await expect.poll(() => git(repo, 'log', '-1', '--format=%s')).toBe('Add a greeting')
})

test('a slow hook streams its output while the commit runs, then Commit & Push reaches the remote', async () => {
  installPreCommitHook(PASSING_HOOK)
  const view = await openGitTab(handle)
  await fileRow(view, 'src/math.ts').locator('input[type=checkbox]').click()
  await expect(gitViewSection(view, /^Staged \(1\)/)).toContainText('src/math.ts')
  await view.getByPlaceholder('Commit message…').fill('Add in either order')
  await view.getByRole('button', { name: 'Commit & Push' }).click()

  await expect(view.locator('.git-view__hook-live')).toContainText('lint: checking staged files')
  await expect(view.getByPlaceholder('Commit message…')).toHaveValue('', { timeout: 15000 })
  await expect(view.locator('.git-view__commit-error')).toBeHidden()
  await expect.poll(() => git(bare, 'log', '-1', '--format=%s', BRANCH)).toBe('Add in either order')
  await expect(gitViewSection(view, /^Changes \(0\)/)).toBeVisible()
})

test('Open PR pushes the branch and opens a pull request on GitHub', async () => {
  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Open PR' }).click()
  const dialog = view.getByRole('dialog', { name: 'Open Pull Request' })
  await expectCentredInWindow(dialog, 'Git: Open Pull Request')
  await expect(dialog.getByPlaceholder('Describe your changes…')).toHaveValue('## What changed\n')
  await dialog.getByPlaceholder('Pull request title').fill('Greet in either order')
  await dialog.getByPlaceholder('Describe your changes…').fill('Adds a greeting.')
  await dialog.getByLabel('Draft').check()
  await dialog.getByRole('button', { name: 'Create Draft PR' }).click()
  await expect(dialog).toBeHidden({ timeout: 15000 })
  await expect(view.getByRole('status').getByRole('link')).toHaveText('#1 Greet in either order')
  // The Git view draws its own toast: the core's would sit under the view.
  await expect(
    view.locator('.tmui-toast__message', { hasText: 'Opened #1 Greet in either order' })
  ).toBeVisible()

  expect(stub.pullRequests).toHaveLength(1)
  const [created] = stub.pullRequests
  expect(created).toMatchObject({
    title: 'Greet in either order',
    body: 'Adds a greeting.',
    baseRefName: 'main',
    headRefName: BRANCH,
    isDraft: true,
  })
})

test('Open PR on a branch that already has one shows that pull request instead', async () => {
  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Open PR' }).click()
  const dialog = view.getByRole('dialog', { name: 'Open Pull Request' })
  await expect(dialog).toContainText('A PR already exists: #1: Greet in either order')
  await expect(dialog.getByRole('button', { name: 'Create PR' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
})

async function runGitQuickAction(mnemonic: string): Promise<void> {
  const { page } = handle
  await page.keyboard.press('Meta+p')
  const panel = page.getByRole('dialog', { name: 'Quick actions' })
  await expect(panel.locator(':focus')).toHaveCount(1, { timeout: 10000 })
  await page.keyboard.press('g')
  await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
  await page.keyboard.press(mnemonic)
  await expect(panel).toBeHidden({ timeout: 10000 })
}

test('the Commit… Quick Action brings the Git tab forward with the message box focused', async () => {
  await projectTab(handle.page, 'Terminal').click()
  await runGitQuickAction('c')
  const view = await openGitTab(handle)
  await expect(view.getByPlaceholder('Commit message…')).toBeFocused()
})

test('the Create PR… Quick Action opens the pull request dialog', async () => {
  await runGitQuickAction('r')
  const view = await openGitTab(handle)
  const dialog = view.getByRole('dialog', { name: 'Open Pull Request' })
  await expect(dialog).toContainText('A PR already exists: #1')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
})

test('the Pull Quick Action fast-forwards the branch to what a teammate pushed', async () => {
  const teammate = mkdtempSync(join(tmpdir(), 'terminator-e2e-teammate-'))
  git(teammate, 'clone', '--quiet', '--branch', BRANCH, bare, '.')
  git(teammate, 'config', 'user.email', 'mate@example.com')
  git(teammate, 'config', 'user.name', 'Mate')
  writeFile(teammate, 'docs/notes.md', 'from a teammate\n')
  git(teammate, 'add', '-A')
  git(teammate, 'commit', '--quiet', '-m', 'teammate: add notes')
  git(teammate, 'push', '--quiet')
  rmSync(teammate, { recursive: true, force: true })

  await runGitQuickAction('l')
  // The Git tab is still on screen, so its view draws the toast: the core's would sit under it.
  const view = await gitView(handle, 'project')
  await expect(view.locator('.tmui-toast__message', { hasText: 'Pulled' })).toContainText(
    `Pulled ${BRANCH}`,
    { timeout: 15000 }
  )
  expect(existsSync(join(repo, 'docs/notes.md'))).toBe(true)
  expect(readFileSync(join(repo, 'docs/notes.md'), 'utf8')).toBe('from a teammate\n')
})
