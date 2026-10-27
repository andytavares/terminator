import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  launchApp,
  closeApp,
  createWorkspace,
  e2eTempDir,
  projectGroup,
  workspaceRow,
} from './helpers'
import type { AppHandle } from './helpers'
import { openHome, runInVisibleTerminal } from './session-views'

// Home's Tasks layout against the running app (ADR 127): one task across three repos, a question
// in one lane in the Needs you queue, a fourth branch added from the sidebar, and the sidebar
// grouped by task. Addressed by role and name (contracts/ui-surfaces.md).

const TITLE = 'Rate limits across services'
const BRANCH = 'rate-limits'
const REPOS = ['terminator', 'api-gateway', 'web-console']
const EXTRA_BRANCH = 'docs-fix'

// A numbered choice as Claude Code draws it. ❯ is sent as its UTF-8 bytes in octal: typed as
// itself it reaches a shell with no UTF-8 locale (as on CI) as unknown characters.
const QUESTION_TEXT = 'Do you want to create RateLimitBanner.tsx?'
const QUESTION =
  `clear; printf ' ${QUESTION_TEXT}\\n \\342\\235\\257 1. Yes\\n ` +
  "  2. Yes, and allow edits this session\\n   3. No\\n'"

/** An empty gh config keeps the developer's own pull requests out of the queue. */
const NO_GITHUB = () => ({ XDG_CONFIG_HOME: e2eTempDir('no-gh-'), GH_TOKEN: '', GITHUB_TOKEN: '' })

/** A repository with one commit, so each branch the app makes reports its own name. */
function gitFolder(): string {
  const folder = e2eTempDir('home-tasks-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
  git('init', '-q')
  const identity = ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.com']
  git(...identity, 'commit', '-q', '--allow-empty', '-m', 'Start')
  return folder
}

/** Waits until the terminal on screen belongs to the branch: a terminal typed into before then
 * may be the previous branch's. The row can appear, vanish and reappear while git makes the
 * worktree, so the click is retried. */
async function selectBranch(page: Page, repo: string, branch: string): Promise<void> {
  await expect(async () => {
    await projectGroup(page, branch).click()
    await expect(page.locator('.tab-bar__scope')).toHaveText(`${repo} · ${branch}`)
  }).toPass()
  await page.getByRole('textbox', { name: 'Terminal input' }).first().waitFor()
}

async function addWorktreeBranch(page: Page, repo: string, branch: string): Promise<void> {
  await workspaceRow(page, repo).hover()
  await workspaceRow(page, repo)
    .locator(`.repo-header__action[aria-label="New branch in ${repo}"]`)
    .click()
  await page.getByPlaceholder('feature/my-feature').fill(branch)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await selectBranch(page, repo, branch)
}

async function startTaskAcrossRepos(page: Page): Promise<void> {
  await openHome(page)
  await page.getByRole('button', { name: /^Start work/ }).click()
  const launcher = page.getByRole('dialog', { name: 'Start work' })
  await launcher.getByRole('tab', { name: 'Across repos' }).click()
  await launcher.getByRole('textbox', { name: 'Task title' }).fill(TITLE)
  await launcher.getByRole('textbox', { name: 'Branch in every repo' }).fill(BRANCH)
  await launcher.getByRole('radio', { name: 'Terminal only' }).click()
  await launcher.getByRole('button', { name: 'Start 3 lanes' }).click()
  await expect(launcher).toBeHidden()
}

const taskRow = (page: Page) =>
  page.getByRole('region', { name: 'Tasks' }).getByRole('button', { name: TITLE, exact: true })

async function homeShowsOneTaskWithThreeRepos(page: Page): Promise<void> {
  await openHome(page)
  await expect(taskRow(page)).toHaveCount(1)
  for (const repo of REPOS) await expect(taskRow(page)).toContainText(repo)
}

async function askInOneLane(page: Page): Promise<void> {
  const lanes = page.getByRole('group', { name: `Lanes of ${TITLE}` })
  await expect(async () => {
    await lanes.getByRole('button', { name: 'api-gateway' }).click()
    await expect(page.locator('.tab-bar__scope')).toHaveText(`api-gateway · ${BRANCH}`)
  }).toPass()
  await runInVisibleTerminal(page, QUESTION)
  await openHome(page)
  const queue = page.getByRole('region', { name: 'Needs you' })
  await expect(queue).toContainText(QUESTION_TEXT)
  await expect(queue.getByRole('listitem')).toHaveCount(1)
}

async function addFourthBranchToTask(page: Page): Promise<void> {
  await addWorktreeBranch(page, 'terminator', EXTRA_BRANCH)
  await projectGroup(page, EXTRA_BRANCH).click({ button: 'right' })
  // The sidebar's context menu items are not role=menuitem: find them by text.
  await page.locator('.ctx-menu').getByText('Add to task…').click()
  const picker = page.getByRole('dialog', { name: 'Add to task' })
  await picker.getByRole('button', { name: TITLE }).click()
  await expect(picker).toBeHidden()
  await openHome(page)
  await taskRow(page).click()
  const drawer = page.getByRole('dialog', { name: TITLE })
  await expect(drawer.getByRole('list', { name: 'Lanes' }).getByRole('listitem')).toHaveCount(4)
  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
}

async function sidebarGroupsByTask(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Display' }).click()
  await page.getByRole('menu').getByText('Task', { exact: true }).click()
  const sidebar = page.locator('.unified-sidebar')
  await expect(sidebar).toContainText(TITLE)
  for (const repo of REPOS) await expect(sidebar).toContainText(`${repo} · ${BRANCH}`)
  await expect(sidebar).toContainText(`terminator · ${EXTRA_BRANCH}`)
}

let handle: AppHandle | undefined

test.afterEach(async () => {
  await closeApp(handle)
  handle = undefined
})

test('a task across three repos shows on Home, asks, grows and groups the sidebar', async () => {
  handle = await launchApp(undefined, NO_GITHUB())
  const { page } = handle
  for (const repo of REPOS) await createWorkspace(page, repo, gitFolder())
  await test.step('Start work → Across repos starts three lanes', () => startTaskAcrossRepos(page))
  await test.step('a numbered choice in one lane is in Needs you once', () => askInOneLane(page))
  await test.step('Home shows one task row with the three repos', () =>
    homeShowsOneTaskWithThreeRepos(page))
  await test.step('Add to task… adds a fourth branch', () => addFourthBranchToTask(page))
  await test.step('Display → Group → Task lists the task with its lanes', () =>
    sidebarGroupsByTask(page))
})

test('Home with nothing asking says so', async () => {
  handle = await launchApp(undefined, NO_GITHUB())
  const { page } = handle
  await openHome(page)
  await expect(page.getByText('Nothing needs you.')).toBeVisible()
})
