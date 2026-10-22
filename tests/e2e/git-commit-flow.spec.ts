import { test, expect, type Locator } from '@playwright/test'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  closeApp,
  closeSettingsPanel,
  launchApp,
  openSettingsSection,
  projectGroup,
  type AppHandle,
} from './helpers'
import { misalignedOn } from './control-alignment'
import { gitIntegrationFrame, type ExtensionView } from './extension-page'
import { openExtensionSettings, settingRow } from './extension-settings-page'
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

/** The Git tab from edit to pull request against the stub GitHub, then Git Integration's
 * settings, global and per workspace. Serial: both flows share one app, and the settings flow
 * runs last because the settings it changes are global. */

let handle: AppHandle
let stub: GithubStub
let repo: string
let bare: string
const directories: string[] = []
const BRANCH = 'feat/greeting'
const PANEL = '[data-extension-panel="terminator.git-integration"]'

/** Plain git pre-commit hooks, no hook manager: progress lines, then an exit status. */
const PASSING_HOOK =
  '#!/bin/sh\necho "lint: checking staged files"\nsleep 1\necho "lint: clean"\nsleep 1\n'
const FAILING_HOOK = '#!/bin/sh\necho "lint: src/greeting.ts has a problem"\nexit 1\n'

test.describe.configure({ mode: 'serial' })

/** A feature branch with a pull request template pushed, and two files changed on top of it. */
function makeFeatureBranchRepo(): void {
  ;({ repo, bare } = makeRepoWithRemote('terminator-e2e-commit'))
  directories.push(repo, bare)
  git(repo, 'checkout', '--quiet', '-b', BRANCH)
  git(repo, 'push', '--quiet', '-u', 'origin', BRANCH)
  writeFile(repo, '.github/pull_request_template.md', '## What changed\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '--quiet', '-m', 'add a pull request template')
  git(repo, 'push', '--quiet')
  writeFile(repo, 'src/greeting.ts', 'export const greeting = "hello"\n')
  writeFile(repo, 'src/math.ts', 'export function add(a: number, b: number) {\n  return b + a\n}\n')
}

test.beforeAll(async () => {
  makeFeatureBranchRepo()
  stub = await startGithubStub({ bareRepo: bare })
  handle = await launchApp(undefined, stub.env)
  await openRepo(handle, 'Commit Flow', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  await stub?.shutDown()
  for (const dir of directories) rmSync(dir, { recursive: true, force: true })
})

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

async function noGitChangesSidePanel(): Promise<void> {
  const { page } = handle
  await expect(page.getByRole('button', { name: 'Git Changes' })).toHaveCount(0)
  await page.keyboard.press('Meta+Shift+G')
  await expect(page.locator(`${PANEL}[data-view-param="sidebar"]`)).toHaveCount(0)
}

async function gitTabRendersTheGitView(): Promise<void> {
  await projectTab(handle.page, 'Git').click()
  await expect(handle.page.locator(`${PANEL}[data-view-param="project"]`)).toBeVisible()
}

/** Buttons and fields drawn by the browser rather than the design system, icons at lucide's
 * 24px fallback, and dialogs that scroll sideways, in the frame it runs in. Git Integration
 * contributes no global tab, so extension-smoke.spec.ts never reaches it. */
const STYLE_PROBE = `(() => {
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width >= 1 && r.height >= 1 }
  const name = (el, fallback) =>
    (el.className || el.getAttribute('aria-label') || fallback).toString().split(' ')[0]
  const bareButtons = [...document.querySelectorAll('button')].filter(shown).filter((el) => {
    const cs = getComputedStyle(el)
    return cs.appearance === 'auto' || cs.borderTopStyle === 'outset'
  }).map((el) => name(el, 'button'))
  const fields = 'input:not([type=checkbox]):not([type=radio]):not([type=hidden]), textarea, select'
  const unstyledInputs = [...document.querySelectorAll(fields)].filter(shown).filter((el) => {
    const cs = getComputedStyle(el)
    return cs.backgroundColor === 'rgb(255, 255, 255)' || cs.borderTopStyle === 'inset'
  }).map((el) => name(el, el.tagName))
  const oversizedIcons = [...document.querySelectorAll('svg')]
    .filter((svg) => Math.round(svg.getBoundingClientRect().height) === 24)
    .map((svg) => name(svg.parentElement || svg, 'svg'))
  const sideScrollers = [...document.querySelectorAll('dialog, [role=dialog]')]
    .filter((el) => el.scrollWidth - el.clientWidth > 1).map((el) => name(el, 'dialog'))
  return {
    bodyLength: document.body.innerText.length,
    bareButtons, unstyledInputs, oversizedIcons, sideScrollers,
  }
})()`

interface StyleReport {
  bodyLength: number
  bareButtons: string[]
  unstyledInputs: string[]
  oversizedIcons: string[]
  sideScrollers: string[]
}

/** What the style probe finds in the Git tab's frame, or null while the frame attaches. */
async function styleReport(): Promise<StyleReport | null> {
  const frame = gitIntegrationFrame(handle, 'project')
  return frame ? ((await frame.evaluate(STYLE_PROBE)) as StyleReport) : null
}

async function everythingOnTheGitTabIsStyled(): Promise<void> {
  // The view is its own chunk (React.lazy), so it renders after the load event.
  await expect.poll(async () => (await styleReport())?.bodyLength ?? 0).toBeGreaterThan(20)
  expect(await styleReport()).toMatchObject({
    bareButtons: [],
    unstyledInputs: [],
    oversizedIcons: [],
    sideScrollers: [],
  })
}

async function selectingAFileShowsItsDiff(): Promise<void> {
  const view = await openGitTab(handle)
  await fileRow(view, 'src/math.ts').click()
  await expect(view.locator('.diff-line--add')).toContainText('return b + a')
  await expect(view.locator('.diff-line--remove')).toContainText('return a + b')
  expect(await misalignedOn(view, 'Git tab')).toEqual([])
}

async function stagingFollowsTheCheckboxes(): Promise<void> {
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
}

async function stageOneAndWriteMessage(path: string, message: string): Promise<ExtensionView> {
  const view = await openGitTab(handle)
  await fileRow(view, path).locator('input[type=checkbox]').click()
  await expect(gitViewSection(view, /^Staged \(1\)/)).toContainText(path)
  await view.getByPlaceholder('Commit message…').fill(message)
  return view
}

async function aFailingHookIsReportedAndBypassed(): Promise<void> {
  installPreCommitHook(FAILING_HOOK)
  const view = await stageOneAndWriteMessage('src/greeting.ts', 'Add a greeting')
  await view.getByRole('button', { name: 'Commit', exact: true }).click()

  await expect(view.locator('.git-view__commit-error-msg')).toHaveText('Pre-commit hooks failed.')
  await view.getByText('Hook output').click()
  await expect(view.locator('.git-view__hook-output-pre')).toContainText('has a problem')
  expect(git(repo, 'log', '-1', '--format=%s')).toBe('add a pull request template')

  await view.getByRole('button', { name: 'Commit without hooks' }).click()
  await expect(view.locator('.git-view__commit-error')).toBeHidden()
  await expect.poll(() => git(repo, 'log', '-1', '--format=%s')).toBe('Add a greeting')
}

async function aSlowHookStreamsThenCommitAndPushReachesTheRemote(): Promise<void> {
  installPreCommitHook(PASSING_HOOK)
  const view = await stageOneAndWriteMessage('src/math.ts', 'Add in either order')
  await view.getByRole('button', { name: 'Commit & Push' }).click()

  await expect(view.locator('.git-view__hook-live')).toContainText('lint: checking staged files')
  await expect(view.getByPlaceholder('Commit message…')).toHaveValue('')
  await expect(view.locator('.git-view__commit-error')).toBeHidden()
  await expect.poll(() => git(bare, 'log', '-1', '--format=%s', BRANCH)).toBe('Add in either order')
  await expect(gitViewSection(view, /^Changes \(0\)/)).toBeVisible()
}

async function fillAndCreateDraftPr(dialog: Locator): Promise<void> {
  await expectCentredInWindow(dialog, 'Git: Open Pull Request')
  await expect(dialog.getByPlaceholder('Describe your changes…')).toHaveValue('## What changed\n')
  await dialog.getByPlaceholder('Pull request title').fill('Greet in either order')
  await dialog.getByPlaceholder('Describe your changes…').fill('Adds a greeting.')
  await dialog.getByLabel('Draft').check()
  await dialog.getByRole('button', { name: 'Create Draft PR' }).click()
  await expect(dialog).toBeHidden()
}

async function openPrCreatesAPullRequest(): Promise<void> {
  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Open PR' }).click()
  await fillAndCreateDraftPr(view.getByRole('dialog', { name: 'Open Pull Request' }))
  await expect(view.getByRole('status').getByRole('link')).toHaveText('#1 Greet in either order')
  // The Git view draws its own toast: the core's would sit under the view.
  await expect(
    view.locator('.tmui-toast__message', { hasText: 'Opened #1 Greet in either order' })
  ).toBeVisible()
  expect(stub.pullRequests).toHaveLength(1)
  expect(stub.pullRequests[0]).toMatchObject({
    title: 'Greet in either order',
    body: 'Adds a greeting.',
    baseRefName: 'main',
    headRefName: BRANCH,
    isDraft: true,
  })
}

async function openPrShowsTheExistingPullRequest(): Promise<void> {
  const view = await openGitTab(handle)
  await view.getByRole('button', { name: 'Open PR' }).click()
  const dialog = view.getByRole('dialog', { name: 'Open Pull Request' })
  await expect(dialog).toContainText('A PR already exists: #1: Greet in either order')
  await expect(dialog.getByRole('button', { name: 'Create PR' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toBeHidden()
}

async function runGitQuickAction(mnemonic: string): Promise<void> {
  const { page } = handle
  await page.keyboard.press('Meta+p')
  const panel = page.getByRole('dialog', { name: 'Quick actions' })
  await expect(panel.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('g')
  await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
  await page.keyboard.press(mnemonic)
  await expect(panel).toBeHidden()
}

async function commitQuickActionShowsTheMessageBox(): Promise<void> {
  await projectTab(handle.page, 'Terminal').click()
  await runGitQuickAction('c')
  // Not openGitTab: its click on the tab would take the cursor out of the box.
  await expect(projectTab(handle.page, 'Git')).toHaveClass(/tab-bar__tab--active/)
  const view = await gitView(handle, 'project')
  await expect(view.getByPlaceholder('Commit message…')).toBeFocused()
}

async function createPrQuickActionOpensTheDialog(): Promise<void> {
  await runGitQuickAction('r')
  const view = await openGitTab(handle)
  const dialog = view.getByRole('dialog', { name: 'Open Pull Request' })
  await expect(dialog).toContainText('A PR already exists: #1')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
}

function teammatePushesNotes(): void {
  const teammate = mkdtempSync(join(tmpdir(), 'terminator-e2e-teammate-'))
  git(teammate, 'clone', '--quiet', '--branch', BRANCH, bare, '.')
  git(teammate, 'config', 'user.email', 'mate@example.com')
  git(teammate, 'config', 'user.name', 'Mate')
  writeFile(teammate, 'docs/notes.md', 'from a teammate\n')
  git(teammate, 'add', '-A')
  git(teammate, 'commit', '--quiet', '-m', 'teammate: add notes')
  git(teammate, 'push', '--quiet')
  rmSync(teammate, { recursive: true, force: true })
}

async function pullQuickActionFastForwards(): Promise<void> {
  teammatePushesNotes()
  await runGitQuickAction('l')
  // The Git tab is still on screen, so its view draws the toast: the core's would sit under it.
  const view = await gitView(handle, 'project')
  await expect(view.locator('.tmui-toast__message', { hasText: 'Pulled' })).toContainText(
    `Pulled ${BRANCH}`
  )
  expect(existsSync(join(repo, 'docs/notes.md'))).toBe(true)
  expect(readFileSync(join(repo, 'docs/notes.md'), 'utf8')).toBe('from a teammate\n')
}

/** A flow's steps, run in order, each titled with the behaviour it checks. */
type Steps = Array<[title: string, run: () => Promise<void>]>

async function runSteps(steps: Steps): Promise<void> {
  for (const [title, run] of steps) await test.step(title, run)
}

const CHANGE_TO_PULL_REQUEST: Steps = [
  ['there is no Git Changes side panel to toggle', noGitChangesSidePanel],
  ['the Git project tab renders the full git view', gitTabRendersTheGitView],
  ['everything on the Git tab is styled', everythingOnTheGitTabIsStyled],
  ['selecting a changed file shows its diff', selectingAFileShowsItsDiff],
  [
    'checking a file stages it, unchecking unstages it, the index agrees',
    stagingFollowsTheCheckboxes,
  ],
  [
    'a failing pre-commit hook is reported with its output, and bypassed',
    aFailingHookIsReportedAndBypassed,
  ],
  [
    'a slow hook streams its output, then Commit & Push reaches the remote',
    aSlowHookStreamsThenCommitAndPushReachesTheRemote,
  ],
  ['Open PR pushes the branch and opens a pull request on GitHub', openPrCreatesAPullRequest],
  [
    'Open PR on a branch that already has one shows that pull request',
    openPrShowsTheExistingPullRequest,
  ],
  [
    'the Commit… Quick Action brings the Git tab forward with the cursor in the message box',
    commitQuickActionShowsTheMessageBox,
  ],
  ['the Create PR… Quick Action opens the pull request dialog', createPrQuickActionOpensTheDialog],
  [
    'the Pull Quick Action fast-forwards the branch to what a teammate pushed',
    pullQuickActionFastForwards,
  ],
]

test('a change is diffed, staged, committed through its hooks, pushed and opened as a pull request', async () => {
  await runSteps(CHANGE_TO_PULL_REQUEST)
})

// The settings flow: two more checkouts, told apart in the sidebar by their branch names.

/** A checkout whose branch is named `branch`, opened as the workspace `name`. */
async function openRepoOnBranch(name: string, branch: string): Promise<string> {
  const made = makeRepoWithRemote(`terminator-e2e-ws-${branch}`)
  directories.push(made.repo, made.bare)
  git(made.repo, 'branch', '-m', branch)
  await openRepo(handle, name, made.repo)
  return made.repo
}

/** Workspace Settings of the workspace whose branch row `branch` is, opened. */
async function openWorkspaceSettings(branch: string): Promise<Locator> {
  await projectGroup(handle.page, branch).click()
  await openSettingsSection(handle.page, 'Workspace Settings')
  return handle.page.locator('.settings-panel__content')
}

const signOffSwitchIn = (settings: Locator) =>
  settingRow(settings, 'Add sign-off to commits').getByRole('switch')

/** Git Integration's "Use global default", not a core setting's. */
const globalDefaultButtonIn = (settings: Locator) =>
  settings
    .locator('.extension-settings-panel', { hasText: 'Git Integration' })
    .getByRole('button', { name: 'Use global default' })

/** Stages everything and commits it from the Git tab of `branch`; returns the message. */
async function commitAllFrom(branch: string, checkout: string, message: string): Promise<string> {
  await projectGroup(handle.page, branch).click()
  const view = await openGitTab(handle)
  await expect(view.locator('.staging-area__file-row').first()).toBeVisible()
  await view.getByRole('button', { name: 'Stage All' }).click()
  await view.getByPlaceholder('Commit message…').fill(message)
  await view.getByRole('button', { name: 'Commit', exact: true }).click()
  await expect.poll(() => git(checkout, 'log', '-1', '--format=%s')).toBe(message)
  return git(checkout, 'log', '-1', '--format=%B')
}

async function settingsListGitIntegration(): Promise<void> {
  await openSettingsSection(handle.page, 'Extensions')
  await expect(handle.page.locator('.settings-panel__content')).toContainText('Git Integration')
  await closeSettingsPanel(handle.page)
}

async function workspaceSignOffSignsOnlyItsCommits(signed: string, plain: string): Promise<void> {
  const settings = await openWorkspaceSettings('signed-work')
  await expect(signOffSwitchIn(settings)).toHaveAttribute('aria-checked', 'false')
  await signOffSwitchIn(settings).click()
  await expect(globalDefaultButtonIn(settings)).toBeVisible()
  await closeSettingsPanel(handle.page)

  writeFile(signed, 'one.md', 'one\n')
  expect(await commitAllFrom('signed-work', signed, 'Add one.md')).toBe(
    'Add one.md\n\nSigned-off-by: E2E <e2e@example.com>'
  )
  writeFile(plain, 'one.md', 'one\n')
  expect(await commitAllFrom('plain-work', plain, 'Add one.md')).toBe('Add one.md')

  const plainSettings = await openWorkspaceSettings('plain-work')
  await expect(signOffSwitchIn(plainSettings)).toHaveAttribute('aria-checked', 'false')
  await expect(globalDefaultButtonIn(plainSettings)).toBeHidden()
  await closeSettingsPanel(handle.page)
}

async function globalDefaultButtonInHandsSignOffBack(signed: string): Promise<void> {
  const settings = await openWorkspaceSettings('signed-work')
  await expect(signOffSwitchIn(settings)).toHaveAttribute('aria-checked', 'true')
  await globalDefaultButtonIn(settings).click()
  await expect(signOffSwitchIn(settings)).toHaveAttribute('aria-checked', 'false')
  await expect(globalDefaultButtonIn(settings)).toBeHidden()
  await closeSettingsPanel(handle.page)

  writeFile(signed, 'two.md', 'two\n')
  expect(await commitAllFrom('signed-work', signed, 'Add two.md')).toBe('Add two.md')
}

async function changedFilesStopAtTheLimit(plain: string): Promise<void> {
  for (let i = 0; i < 12; i++) writeFile(plain, `note-${String(i).padStart(2, '0')}.md`, `${i}\n`)
  await projectGroup(handle.page, 'plain-work').click()
  const view = await openGitTab(handle)
  await expect(view.locator('.staging-area__file-row')).toHaveCount(12)
  await expect(view.locator('.staging-area__truncation-banner')).toBeHidden()

  const page = await openExtensionSettings(handle.page, 'Git Integration')
  await settingRow(page, 'Max displayed changed files').locator('input').fill('10')
  await closeSettingsPanel(handle.page)

  await expect(view.locator('.staging-area__file-row')).toHaveCount(10)
  await expect(view.locator('.staging-area__truncation-banner')).toHaveText(
    'Showing first 10 files.'
  )
}

async function globalSignOffSignsCommits(plain: string): Promise<void> {
  const page = await openExtensionSettings(handle.page, 'Git Integration')
  await settingRow(page, 'Add sign-off to commits').getByRole('switch').click()
  await closeSettingsPanel(handle.page)
  expect(await commitAllFrom('plain-work', plain, 'Add notes')).toBe(
    'Add notes\n\nSigned-off-by: E2E <e2e@example.com>'
  )
}

test('Git settings limit the changed-files list and sign commits off, globally and per workspace', async () => {
  const signed = await openRepoOnBranch('Signed Repo', 'signed-work')
  const plain = await openRepoOnBranch('Plain Repo', 'plain-work')
  await runSteps([
    [
      'the Git Integration settings section appears in the settings panel',
      settingsListGitIntegration,
    ],
    [
      "sign-off on in one workspace's settings signs its commits, not the other's",
      () => workspaceSignOffSignsOnlyItsCommits(signed, plain),
    ],
    [
      '"Use global default" hands sign-off back to the global value',
      () => globalDefaultButtonInHandsSignOffBack(signed),
    ],
    [
      'the changed-files list stops at "Max displayed changed files" and says so',
      () => changedFilesStopAtTheLimit(plain),
    ],
    [
      'a commit with "Add sign-off to commits" on ends with Signed-off-by',
      () => globalSignOffSignsCommits(plain),
    ],
  ])
})
