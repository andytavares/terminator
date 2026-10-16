import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
} from './helpers'
import { extensionFrame } from './extension-page'
import { expectCentredInWindow } from './modal-centre'

/**
 * Feature 057 — Quick Actions.
 *
 * The command palette (⌘K in a stale comment, ⌘P in reality) is replaced by a
 * leader + which-key panel: ⌘P opens a panel of grouped actions, a letter acts
 * immediately, `/` switches to fuzzy search, and pins/recent survive a
 * restart. This drives the real app end to end, covering the acceptance
 * criteria in specs/057-quick-actions/SPEC.md that a unit test cannot reach:
 * the leader from inside an extension's own WebContentsView, a real git push
 * against a bare remote, a custom action's PTY output, and the double-Escape
 * interaction between the panel and an extension underneath it.
 */

const DIALOG_NAME = 'Quick actions'

function dialog(page: Page) {
  return page.getByRole('dialog', { name: DIALOG_NAME })
}

async function openPanel(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+p')
  const d = dialog(page)
  await expect(d).toBeVisible({ timeout: 10000 })
  // Keys sent before the panel owns focus land in the terminal underneath.
  await expect(d.locator(':focus')).toHaveCount(1)
  await expectCentredInWindow(d, 'Quick actions')
}

/** Waits for a CSS animation/transition on `selector` to finish, not a fixed delay. */
async function waitForAnimationsToFinish(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel)
    if (!el) return false
    return (el as HTMLElement).getAnimations().every((a) => a.playState === 'finished')
  }, selector)
}

/** Run a script inside the extension frame whose URL contains `part`. */
async function inView<T>(handle: AppHandle, part: string, script: string): Promise<T> {
  const frame = extensionFrame(handle, part)
  if (!frame) throw new Error(`no frame for ${part}`)
  return frame.evaluate(script) as Promise<T>
}

/** Press a key inside an extension's frame, with the host page's modifier name. */
async function keyInView(handle: AppHandle, part: string, keyCode: string): Promise<void> {
  const frame = extensionFrame(handle, part)
  if (!frame) throw new Error(`no frame for ${part}`)
  // The frame's document must own focus for its listeners to see the key.
  await frame.evaluate(() => (document.body as HTMLElement).focus())
  await handle.page.keyboard.press(keyCode)
}

async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.evaluate(`(async () => {
    await window.electronAPI.settings.updateGlobal({ appearance: { theme: '${theme}' } })
    document.documentElement.setAttribute('data-theme', '${theme}')
  })()`)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')), {
      timeout: 5000,
    })
    .toBe(theme)
}

// ---------------------------------------------------------------------------
// A. Opening and running the panel from a plain (non-git) workspace.
// ---------------------------------------------------------------------------

// AC1 (part): a focused terminal.
async function opensFromFocusedTerminal(handle: AppHandle): Promise<void> {
  const { page } = handle
  await openPanel(page)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
}

// AC1 (part): Home.
async function opensFromHome(handle: AppHandle): Promise<void> {
  const { page } = handle
  await page.getByRole('button', { name: /^Home/ }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await openPanel(page)
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  // Back to the terminal for the rest of this describe block.
  await handle.page.locator('.branch-row').filter({ hasText: 'scratch' }).click()
  await expect(handle.page.locator('.xterm-helper-textarea').first()).toBeFocused({
    timeout: 10000,
  })
}

// AC16: the rail button.
async function appBandButtonOpensPanel(handle: AppHandle): Promise<void> {
  const { page } = handle
  await page.locator('button[aria-label="Quick actions (⌘P)"]').click()
  await expect(dialog(page)).toBeVisible({ timeout: 10000 })
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
}

// AC2 + AC14: ⌘P t d splits the pane, closes the panel, and teaches ⌘D.
async function leaderTDSplitsAndTeachesShortcut(handle: AppHandle): Promise<void> {
  const { page } = handle
  await expect(page.locator('.xterm')).toHaveCount(1)
  await openPanel(page)
  await page.keyboard.press('t')
  await page.keyboard.press('d')
  await expect(dialog(page)).toBeHidden()
  await expect(page.locator('.xterm')).toHaveCount(2, { timeout: 15000 })
  await expect(page.locator('.tmui-toast__message', { hasText: 'Next time' })).toContainText(
    'Next time: ⌘D',
    {
      timeout: 5000,
    }
  )
}

// AC3: `/` then "push" surfaces Git's Push action through its category.
async function slashSearchFindsPush(handle: AppHandle): Promise<void> {
  const { page } = handle
  await openPanel(page)
  await page.keyboard.press('/')
  await expect(page.getByRole('combobox', { name: 'Search quick actions' })).toBeVisible()
  await page.keyboard.type('push')
  await expect(page.getByRole('option', { name: /Push/ })).toBeVisible({ timeout: 5000 })
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
}

/** Opens the panel, runs the row `rowKey` of the group `groupKey` (listed as `groupLabel`), and waits
 * for the panel to close. The mnemonic listener is rebound on every mode change (QuickActions.tsx),
 * so the row's key goes only once the group's listbox has rendered. Generous on closing: the first
 * time an extension's view is created it can cold-load, and closing goes through the same
 * main-process path. */
async function runGroupRow(
  page: Page,
  group: { key: string; label: string },
  rowKey: string
): Promise<void> {
  await openPanel(page)
  await page.keyboard.press(group.key)
  await expect(page.getByRole('listbox', { name: group.label })).toBeVisible()
  await page.keyboard.press(rowKey)
  await expect(dialog(page)).toBeHidden({ timeout: 15000 })
}

// AC6 (part): Notepad's manifest command.
async function leaderNNOpensNotepadQuickCreate(handle: AppHandle): Promise<void> {
  await runGroupRow(handle.page, { key: 'n', label: 'Notes' }, 'n')
  await expect
    .poll(
      async () =>
        inView<boolean>(
          handle,
          'notepad',
          `!!document.querySelector('dialog[open][aria-label="New note"]')`
        ).catch(() => false),
      { timeout: 15000, message: 'Notepad quick-create overlay never appeared' }
    )
    .toBe(true)
}

// AC6 (part): Task Vault's manifest command.
async function leaderVCOpensTaskVaultCapture(handle: AppHandle): Promise<void> {
  await runGroupRow(handle.page, { key: 'v', label: 'Task Vault' }, 'c')
  await expect
    .poll(
      async () => inView<string>(handle, 'task-vault', `document.body.innerText`).catch(() => ''),
      { timeout: 15000, message: 'Task Vault capture overlay never appeared' }
    )
    .toContain('Capture to Inbox')
}

// AC1 (part) + AC15: the leader from inside an extension view, and Escape
// closing only the panel — not the extension, and not counted twice.
async function leaderInsideNotesOpensPanel(handle: AppHandle): Promise<void> {
  const { page } = handle
  // The previous test left Task Vault as the active extension panel — bring
  // Notes forward explicitly rather than assuming what came before it.
  const notesPanel = page.locator('[data-extension-panel="terminator.notepad"]')
  if ((await notesPanel.count()) === 0) {
    await page.locator('button[aria-label="Notes"]').click()
  }
  await expect(notesPanel).toHaveCount(1, { timeout: 10000 })
  await expect
    .poll(
      async () => {
        const frame = extensionFrame(handle, 'notepad')
        if (!frame) return false
        return frame.evaluate(() => document.readyState === 'complete').catch(() => false)
      },
      { timeout: 15000 }
    )
    .toBe(true)

  await keyInView(handle, 'notepad', 'ControlOrMeta+p')
  await expect(dialog(page)).toBeVisible({ timeout: 10000 })
  // Escape closes the panel from inside it; pressed before focus has moved
  // there from the extension's view, it closes nothing (as core-ipc found).
  await expect(dialog(page).locator(':focus')).toHaveCount(1)

  // A single Escape closes only the panel — Notes stays the active surface.
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
  await expect(page.locator('[data-extension-panel="terminator.notepad"]')).toHaveCount(1)

  // A second Escape, close on the heels of the first, must not read as the
  // second half of a double-Escape exit: the panel's own Escape must not
  // have counted toward it.
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-extension-panel="terminator.notepad"]')).toHaveCount(1)
}

/** The app on a plain workspace's scratch branch, its terminal focused. */
async function appOnScratchTerminal(folder: string): Promise<AppHandle> {
  const handle = await launchApp()
  await createWorkspace(handle.page, 'QA Workspace', folder)
  await addAndSelectProject(handle.page, 'QA Workspace', 'scratch')
  await handle.page.locator('.xterm').first().click()
  await expect(handle.page.locator('.xterm-helper-textarea').first()).toBeFocused({
    timeout: 10000,
  })
  return handle
}

test.describe('opening and running the panel', () => {
  let handle: AppHandle
  let folder: string

  test.beforeAll(async () => {
    folder = e2eTempDir('terminator-e2e-qa-')
    handle = await appOnScratchTerminal(folder)
  })

  test.afterAll(async () => {
    await closeApp(handle)
    rmSync(folder, { recursive: true, force: true })
  })

  test('AC1: ⌘P opens the panel from a focused terminal', () => opensFromFocusedTerminal(handle))

  test('AC1: ⌘P opens the panel from Home', () => opensFromHome(handle))

  test('AC16: the AppBand "Quick actions (⌘P)" button opens the panel', () =>
    appBandButtonOpensPanel(handle))

  test('AC2 + AC14: ⌘P t d splits the focused pane, closes the panel, and shows "Next time: ⌘D"', () =>
    leaderTDSplitsAndTeachesShortcut(handle))

  test('AC3: `/` then typing "push" lists an option whose name contains "Push"', () =>
    slashSearchFindsPush(handle))

  test('AC6: ⌘P n n shows the Notepad quick-create overlay', () =>
    leaderNNOpensNotepadQuickCreate(handle))

  test('AC6: ⌘P v c shows the Task Vault capture overlay', () =>
    leaderVCOpensTaskVaultCapture(handle))

  test('AC1 + AC15: ⌘P from inside the Notes view opens the panel; Escape closes only the panel', () =>
    leaderInsideNotesOpensPanel(handle))
})

// ---------------------------------------------------------------------------
// A2. With no repository focused at all (no workspace, no branch selected),
// Git Push is dimmed and inert. `repoRoot` falls back through the active
// project's worktree to the active workspace's folder (App.tsx), so this
// needs a fresh app with neither — a non-git branch's folder would still
// count as a focused repository.
// ---------------------------------------------------------------------------

test.describe('no repository focused', () => {
  let handle: AppHandle

  test.beforeAll(async () => {
    handle = await launchApp()
  })

  test.afterAll(async () => {
    await closeApp(handle)
  })

  test('AC7: Git Push is dimmed with a reason and does not run', async () => {
    const { page } = handle
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await openPanel(page)
    await page.keyboard.press('g')
    await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
    const pushRow = page.getByRole('option', { name: /Push/ })
    await expect(pushRow).toHaveClass(/qa-row--disabled/)
    await expect(pushRow.locator('.qa-row__reason')).toHaveText('No repository focused')
    await page.keyboard.press('p')
    // Disabled: the row shows its reason in the footer and the panel stays open.
    await expect(page.locator('.qa-footer__message')).toHaveText('No repository focused')
    await expect(dialog(page)).toBeVisible()
    await expect(page.locator('.tmui-toast__message', { hasText: /push/i })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })
})

// ---------------------------------------------------------------------------
// B. Pins and recent actions survive a relaunch.
// ---------------------------------------------------------------------------

/** This story's app: launched by its test, and relaunched on the same profile. */
let relaunched: AppHandle

async function recentAndPinsSurviveRestart(): Promise<void> {
  relaunched = await launchApp()
  const { page } = relaunched

  for (let i = 0; i < 3; i++) {
    await openPanel(page)
    await page.keyboard.press('b') // core.toggle-sidebar: top-level, always enabled.
    await expect(dialog(page)).toBeHidden()
  }

  await openPanel(page)
  const recentList = page.getByRole('listbox', { name: 'Pinned & recent' })
  await expect(recentList).toBeVisible()
  await expect(recentList.getByRole('option', { name: /Toggle sidebar/ })).toBeVisible()

  // Highlight starts on the first row of "Pinned & recent" (no context group
  // on Home), which is our just-used action — pin it.
  await page.keyboard.press('ControlOrMeta+.')
  await expect(recentList.getByRole('option').first()).toContainText('Toggle sidebar')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()

  // Reopen without restarting: still first.
  await openPanel(page)
  await expect(
    page.getByRole('listbox', { name: 'Pinned & recent' }).getByRole('option').first()
  ).toContainText('Toggle sidebar')
  await page.keyboard.press('Escape')

  // Restart the app on the same profile.
  const userDataDir = relaunched.userDataDir
  await closeApp(relaunched)
  relaunched = await launchApp(userDataDir)

  await openPanel(relaunched.page)
  await expect(
    relaunched.page.getByRole('listbox', { name: 'Pinned & recent' }).getByRole('option').first()
  ).toContainText('Toggle sidebar')
}

test.describe('pins and recent survive a relaunch', () => {
  test.afterAll(async () => {
    await closeApp(relaunched)
  })

  test(
    'AC8: an action run 3 times appears in Recent; pinning puts it first, and both survive a restart',
    recentAndPinsSurviveRestart
  )
})

const WS = 'QA Git Workspace'

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** A repository with a commit its origin does not have yet, for Push to push. */
function repositoryAheadOfOrigin(): { bareDir: string; workDir: string } {
  const bareDir = e2eTempDir('terminator-e2e-qa-bare-')
  const workDir = e2eTempDir('terminator-e2e-qa-work-')
  git(bareDir, 'init', '--bare', '-b', 'main')
  git(workDir, 'init', '-b', 'main')
  git(workDir, 'config', 'user.email', 'e2e@example.com')
  git(workDir, 'config', 'user.name', 'E2E')
  git(workDir, 'remote', 'add', 'origin', bareDir)
  git(workDir, 'commit', '--allow-empty', '-m', 'root')
  git(workDir, 'push', '-u', 'origin', 'main')
  // A local commit not yet on the remote, for Push to have something to do.
  git(workDir, 'commit', '--allow-empty', '-m', 'second')
  return { bareDir, workDir }
}

// ---------------------------------------------------------------------------
// C. Git push against a real bare remote, and a custom shell action.
// ---------------------------------------------------------------------------

// AC7 (part): the real push, verified against the remote.
async function gitPushCatchesOriginUp(handle: AppHandle, workDir: string): Promise<void> {
  const { page } = handle
  const headBefore = git(workDir, 'rev-parse', 'HEAD')
  const remoteBefore = git(workDir, 'rev-parse', 'origin/main')
  expect(headBefore).not.toBe(remoteBefore)

  await openPanel(page)
  await page.keyboard.press('g')
  await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
  await expect(page.getByRole('option', { name: /^p Push/ })).toBeVisible()
  await page.keyboard.press('p')
  await expect(dialog(page)).toBeHidden({ timeout: 10000 })
  await expect(page.locator('.tmui-toast__message', { hasText: 'Pushed' })).toContainText(
    'Pushed main to origin',
    {
      timeout: 15000,
    }
  )

  git(workDir, 'fetch', 'origin')
  expect(git(workDir, 'rev-parse', 'origin/main')).toBe(headBefore)
}

/** Adds, in Settings, the "Echo branch" action on `x e`, which writes the branch to `echoed`. */
async function addEchoBranchAction(page: Page, echoed: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,')
  await page.waitForSelector('.settings-panel', { timeout: 5000 })
  await page
    .locator('.settings-section__title', { hasText: 'Quick actions' })
    .scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: 'Add action' }).click()
  await page.locator('#qa-action-label').fill('Echo branch')
  await page.locator('#qa-action-key').fill('e')
  await page.locator('#qa-action-target').selectOption('new-tab')
  await page.locator('#qa-action-body').fill(`echo {branch} | tee '${echoed}'`)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('.qa-settings-list__label', { hasText: 'Echo branch' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-panel')).toBeHidden()
}

// AC10: a custom shell action with a variable, targeting a new tab.
async function customShellActionEchoesBranch(handle: AppHandle, workDir: string): Promise<void> {
  const { page } = handle
  // tee: the branch goes to the terminal and to a file the test can read. The
  // WebGL renderer draws to a canvas, so the terminal has no DOM text to read.
  const echoed = join(workDir, 'echoed-branch.txt')
  await addEchoBranchAction(page, echoed)

  const tabsBefore = await page.locator('.tab-bar__tab--session').count()

  await openPanel(page)
  await page.keyboard.press('x')
  await page.keyboard.press('e')
  await expect(dialog(page)).toBeHidden()

  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(tabsBefore + 1, {
    timeout: 15000,
  })
  await expect
    .poll(() => (existsSync(echoed) ? readFileSync(echoed, 'utf8').trim() : ''), {
      timeout: 15000,
      message: 'the new tab never echoed the branch name',
    })
    .toBe('main')
}

test.describe('git push and a custom shell action', () => {
  let handle: AppHandle
  let bareDir: string
  let workDir: string
  test.beforeAll(async () => {
    const repository = repositoryAheadOfOrigin()
    bareDir = repository.bareDir
    workDir = repository.workDir
    handle = await launchApp()
    await createWorkspace(handle.page, WS, workDir)
    await handle.page.locator('.branch-row').first().click()
    await handle.page.waitForSelector('.tab-bar__tab--session', { timeout: 15000 })
    await expect(handle.page.locator('.xterm-helper-textarea').first()).toBeFocused({
      timeout: 10000,
    })
  })

  test.afterAll(async () => {
    await closeApp(handle)
    rmSync(bareDir, { recursive: true, force: true })
    rmSync(workDir, { recursive: true, force: true })
  })

  test('AC7: Git Push runs in the focused worktree, and origin/main catches up to HEAD', () =>
    gitPushCatchesOriginUp(handle, workDir))

  test('AC10: a custom shell action "echo {branch}" targeting a new tab writes the branch to the terminal', () =>
    customShellActionEchoesBranch(handle, workDir))
})

// ---------------------------------------------------------------------------
// D. Screenshots, top level and the Git group, dark and light.
// ---------------------------------------------------------------------------

async function capturesPanelInBothThemes(handle: AppHandle): Promise<void> {
  const { page } = handle

  // The panel fades in over ~120ms (QuickActions.css), long after `toBeVisible` holds, so the
  // capture waits for the animation itself to finish.
  await setTheme(page, 'dark')
  await openPanel(page)
  await waitForAnimationsToFinish(page, '.qa-panel')
  await page.screenshot({ path: 'test-results/quick-actions/panel-top-dark.png' })
  await page.keyboard.press('g')
  await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
  await waitForAnimationsToFinish(page, '.qa-panel')
  await page.screenshot({ path: 'test-results/quick-actions/panel-git-dark.png' })
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()

  await setTheme(page, 'light')
  await openPanel(page)
  await waitForAnimationsToFinish(page, '.qa-panel')
  await page.screenshot({ path: 'test-results/quick-actions/panel-top-light.png' })
  await page.keyboard.press('g')
  await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
  await waitForAnimationsToFinish(page, '.qa-panel')
  await page.screenshot({ path: 'test-results/quick-actions/panel-git-light.png' })
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
}

test.describe('panel screenshots', () => {
  let handle: AppHandle
  let folder: string

  test.beforeAll(async () => {
    folder = e2eTempDir('terminator-e2e-qa-shots-')
    handle = await launchApp()
    await createWorkspace(handle.page, 'QA Shots', folder)
    await addAndSelectProject(handle.page, 'QA Shots', 'scratch')
  })

  test.afterAll(async () => {
    await closeApp(handle)
    rmSync(folder, { recursive: true, force: true })
  })

  test('the panel and the Git group are captured in dark and light themes', () =>
    capturesPanelInBothThemes(handle))
})
