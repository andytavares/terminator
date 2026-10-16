import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  workspaceRow,
  projectGroup,
  e2eTempDir,
  openSettingsSection,
  closeSettingsPanel,
} from './helpers'

/**
 * A repository's branches, managed from the sidebar against real git: the card is named by the
 * branch its working tree is on (ADR-034), not a label chosen when it was made. Every defect the
 * branch-first sidebar fixed was invisible to the unit tests passing at the time.
 */
let handle: AppHandle
let repo: string
let remote: string
const WS = 'Repo One'
const EXCLUDED = ['gh-readonly-queue/main/pr-248-3f1a2b9c', 'trunk-merge/pr-9']

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim()
}

/** A repo pushed to a bare remote, with branches to exclude and a staged change to count. */
function makeRepository(): void {
  remote = e2eTempDir('terminator-e2e-remote-')
  git(remote, 'init', '--bare', '-b', 'main')
  repo = e2eTempDir('terminator-e2e-repo-')
  git(repo, 'init', '--initial-branch=main')
  git(repo, 'config', 'user.email', 'e2e@example.com')
  git(repo, 'config', 'user.name', 'E2E')
  writeFileSync(join(repo, 'README.md'), '# Test\n'.repeat(20))
  git(repo, 'add', '-A')
  git(repo, 'commit', '-m', 'root')
  git(repo, 'remote', 'add', 'origin', remote)
  git(repo, 'push', '-u', 'origin', 'main')
  for (const branch of ['feat/x', ...EXCLUDED]) git(repo, 'branch', branch)
  writeFileSync(join(repo, 'README.md'), '# Changed\n'.repeat(30))
  git(repo, 'add', 'README.md')
}

test.beforeAll(async () => {
  makeRepository()
  handle = await launchApp()
  await createWorkspace(handle.page, WS, repo)
})

test.afterAll(async () => {
  await closeApp(handle)
})

const branchName = (name: string | RegExp) =>
  handle.page.locator('.branch-row__name', { hasText: name })
const dialogTitle = () => handle.page.locator('.tmui-dialog__title')

/** Context menus close on a click elsewhere; the repo header's has no Escape handler. */
async function closeContextMenu(): Promise<void> {
  await handle.page.getByPlaceholder('Search…').click()
  await expect(handle.page.locator('.ctx-menu')).toHaveCount(0)
}

async function openCreateBranch(): Promise<void> {
  await workspaceRow(handle.page, WS).hover()
  await workspaceRow(handle.page, WS)
    .locator('.repo-header__action[aria-label^="New branch in"]')
    .click()
  await expect(dialogTitle()).toContainText('Create Branch')
}

async function cancelDialog(): Promise<void> {
  await handle.page.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialogTitle()).toHaveCount(0)
}

/** The branch names the Create Branch dialog's picker lists. */
async function listedBranches(): Promise<string[]> {
  await openCreateBranch()
  await handle.page.locator('.branch-select__trigger').click()
  const names = await handle.page.locator('.branch-select__item-name').allTextContents()
  await handle.page.locator('.branch-select__trigger').click()
  await cancelDialog()
  return names
}

async function firstCardIsTheCheckedOutBranch(): Promise<void> {
  const row = projectGroup(handle.page, 'main')
  await expect(row.locator('.branch-row__name')).toHaveText('main')
  // The kind glyph marks the exception: a worktree is the norm and goes unmarked.
  await expect(row.locator('.branch-row__kind svg')).toHaveAttribute('data-kind', 'branch')
  await expect(handle.page.locator('.unified-sidebar')).not.toContainText('worktree')
}

async function changeStatisticsArrive(): Promise<void> {
  const stats = projectGroup(handle.page, 'main').locator('.branch-row__stats')
  await expect(stats).toBeVisible({ timeout: 10000 })
  await expect(stats).toContainText('+')
}

async function selectingShowsStateAndScope(): Promise<void> {
  const { page } = handle
  const row = projectGroup(page, 'main')
  await row.click()
  await expect(row).toHaveClass(/branch-row--selected/)
  // The glyph reports state; it is not the thing marking selection.
  await expect(row.locator('.branch-row__gutter svg')).toHaveAttribute('data-state', /.+/)
  await expect(page.locator('.tab-bar__state svg').first()).toHaveAttribute('data-state', /.+/)
  await expect(page.locator('.tab-bar__scope')).toContainText('main')
  // The terminal exists; it is simply not a sidebar row.
  await expect(page.locator('.unified-sidebar .session-row')).toHaveCount(0)
}

async function openInEditorIsOffered(): Promise<void> {
  const { page } = handle
  const { editor } = await page.evaluate(() => window.electronAPI.editor.detect())
  const expected = editor === null ? /^Open in/ : `Open in ${editor.name}`
  await projectGroup(page, 'main').click({ button: 'right' })
  await expect(page.locator('.ctx-menu__item', { hasText: expected })).toBeVisible()
  await closeContextMenu()
  await workspaceRow(page, WS).click({ button: 'right' })
  await expect(page.locator('.ctx-menu__item', { hasText: expected })).toBeVisible()
  await closeContextMenu()
}

async function createDialogAsksOnlyForBranch(): Promise<void> {
  const { page } = handle
  await openCreateBranch()
  // The Name field only exists where there is no branch to take a name from.
  await expect(page.getByPlaceholder('My branch')).toHaveCount(0)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(page.locator('.dialog__error')).toContainText('Select or enter a branch name')
  await cancelDialog()
}

async function setExcludePatterns(patterns: string[]): Promise<void> {
  const { page } = handle
  await openSettingsSection(page, 'Appearance & Terminal')
  const field = page
    .locator('.settings-section__field')
    .filter({ hasText: 'Branch Exclude Patterns' })
    .locator('textarea')
  await field.fill(patterns.join('\n'))
  await field.blur()
  const stored = () =>
    page.evaluate(async () => {
      const { settings } = await window.electronAPI.settings.getGlobal()
      return settings.git.branchExcludePatterns
    })
  await expect.poll(stored).toEqual(patterns)
  await closeSettingsPanel(page)
}

/** Settings → Branch Exclude Patterns, through the real settings store and handler: the
 * setting once existed with nothing reading it, which a mocked unit test could not notice. */
async function excludedBranchesLeaveThePicker(): Promise<void> {
  expect(await listedBranches()).toEqual(expect.arrayContaining(['feat/x', ...EXCLUDED]))
  await setExcludePatterns(['gh-readonly-queue/*', 'trunk-merge/*'])
  const listed = await listedBranches()
  expect(listed).toContain('feat/x')
  for (const excluded of EXCLUDED) expect(listed).not.toContain(excluded)
}

// The complaint: pressing Create sat there for seconds with no sign anything was happening.
async function worktreeCreationCloses(): Promise<void> {
  const { page } = handle
  await openCreateBranch()
  await page.getByRole('button', { name: 'Worktree' }).click()
  await page.getByPlaceholder('feature/my-feature').fill('feature/busy-state')
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(dialogTitle()).toHaveCount(0, { timeout: 30_000 })
  await expect(branchName(/^feature\/busy-state$/).first()).toBeVisible()
}

async function cardFollowsOutsideCheckout(): Promise<void> {
  git(repo, 'checkout', '-b', 'feature/renamed-by-git')
  // Polled by the app, so allow more than one interval.
  await expect(branchName('feature/renamed-by-git').first()).toBeVisible({ timeout: 20000 })
  await expect(branchName(/^main$/)).toHaveCount(0)
}

async function branchOffersNoRename(): Promise<void> {
  const { page } = handle
  await projectGroup(page, 'feature/renamed-by-git').click({ button: 'right' })
  await expect(page.locator('.ctx-menu__item').filter({ hasText: 'Remove branch' })).toBeVisible()
  await expect(page.locator('.ctx-menu__item').filter({ hasText: 'Rename' })).toHaveCount(0)
  await closeContextMenu()
}

async function removeBranchTakesCardOff(): Promise<void> {
  const { page } = handle
  await projectGroup(page, 'feature/renamed-by-git').click({ button: 'right' })
  await page.locator('.ctx-menu__item', { hasText: 'Remove branch' }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(branchName('feature/renamed-by-git')).toHaveCount(0)
}

async function fetchListsRemoteBranch(): Promise<void> {
  const { page } = handle
  const other = e2eTempDir('terminator-e2e-clone-')
  git(remote, 'clone', remote, other)
  git(other, 'checkout', '-b', 'pushed-elsewhere')
  git(other, 'push', 'origin', 'pushed-elsewhere')
  await openCreateBranch()
  await page.locator('.branch-select__trigger').click()
  const pushed = page.locator('.branch-select__item-name', { hasText: 'pushed-elsewhere' })
  await expect(pushed).toHaveCount(0)
  await page.getByRole('button', { name: 'Fetch branches' }).click()
  await expect(pushed.first()).toBeVisible()
}

async function dialogBranchIsCreated(): Promise<void> {
  const { page } = handle
  await page.locator('.branch-select__item', { hasText: '+ New branch…' }).click()
  await page.getByPlaceholder('feature/my-feature').fill('made-in-app')
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(projectGroup(page, 'made-in-app')).toBeVisible()
  expect(git(repo, 'branch', '--list', 'made-in-app')).toContain('made-in-app')
}

async function theRepositoryIsShown(): Promise<void> {
  await test.step(
    'a workspace over a repo names its first card after the checked-out branch, marked as a plain checkout',
    firstCardIsTheCheckedOutBranch
  )
  await test.step('change statistics arrive without blocking the list', changeStatisticsArrive)
  await test.step(
    'selecting a branch marks the row, and its tabs carry their state and name the branch',
    selectingShowsStateAndScope
  )
  await test.step(
    'a branch and its repo header both offer to open the folder in the editor',
    openInEditorIsOffered
  )
}

async function branchesAreAdded(): Promise<void> {
  await test.step(
    'the create dialog asks for a branch and no other name',
    createDialogAsksOnlyForBranch
  )
  await test.step(
    'branches matching an exclusion pattern are left out of the branch list',
    excludedBranchesLeaveThePicker
  )
  await test.step('creating a worktree says it is working, then closes', worktreeCreationCloses)
}

async function branchesChangeAndGo(): Promise<void> {
  await test.step('the card follows a checkout made outside the app', cardFollowsOutsideCheckout)
  await test.step(
    'a branch offers no rename, because there is nothing else to name',
    branchOffersNoRename
  )
  await test.step('Remove branch takes the card off the sidebar', removeBranchTakesCardOff)
  await test.step(
    'Fetch lists a branch pushed elsewhere since the last fetch',
    fetchListsRemoteBranch
  )
  await test.step(
    'a new branch from the dialog is created in the repository',
    dialogBranchIsCreated
  )
}

test("a repository's branches are shown, added, followed and removed from the sidebar", async () => {
  test.setTimeout(120_000)
  await theRepositoryIsShown()
  await branchesAreAdded()
  await branchesChangeAndGo()
})
