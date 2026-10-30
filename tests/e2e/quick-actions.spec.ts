import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
  projectGroup,
} from './helpers'
import { expectTerminalFocused } from './session-views'
import { extensionFrame } from './extension-page'
import { expectCentredInWindow } from './modal-centre'

// Feature 057, Quick Actions: what https://github.com/andytavares/terminator/blob/8e1f355937df5328fc4e8fc52f5d1e794e949a6b/specs/057-quick-actions/SPEC.md asks that a unit test cannot
// reach — the leader inside an extension's view, a real push to a bare remote, a custom action's
// PTY output, and Escape between the panel and an extension underneath it.

function dialog(page: Page) {
  return page.getByRole('dialog', { name: 'Quick actions' })
}

async function openPanel(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+p')
  const d = dialog(page)
  await expect(d).toBeVisible()
  // Keys sent before the panel owns focus land in the terminal underneath.
  await expect(d.locator(':focus')).toHaveCount(1)
  await expectCentredInWindow(d, 'Quick actions')
}

async function closePanel(page: Page): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeHidden()
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

async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.evaluate(`(async () => {
    await window.electronAPI.settings.updateGlobal({ appearance: { theme: '${theme}' } })
    document.documentElement.setAttribute('data-theme', '${theme}')
  })()`)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
    .toBe(theme)
}

// ---------------------------------------------------------------------------
// First run: no repository focused, then recent actions and a pin.
// ---------------------------------------------------------------------------

// AC7 (part): `repoRoot` falls back through the active project's worktree to the
// active workspace's folder (App.tsx), so only an app with neither has no repository.
async function gitPushDimmedWithoutRepository(page: Page): Promise<void> {
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
  await closePanel(page)
}

function firstPinnedOrRecent(page: Page) {
  return page.getByRole('listbox', { name: 'Pinned & recent' }).getByRole('option').first()
}

// AC8: run three times, it is recent; pinned, it is first.
async function recentThenPinned(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await openPanel(page)
    await page.keyboard.press('b') // core.toggle-sidebar: top-level, always enabled.
    await expect(dialog(page)).toBeHidden()
  }
  await openPanel(page)
  const recentList = page.getByRole('listbox', { name: 'Pinned & recent' })
  await expect(recentList.getByRole('option', { name: /Toggle sidebar/ })).toBeVisible()
  // The highlight starts on the first row of "Pinned & recent" (no context group on Home).
  await page.keyboard.press('ControlOrMeta+.')
  await expect(firstPinnedOrRecent(page)).toContainText('Toggle sidebar')
  await closePanel(page)
  await openPanel(page)
  await expect(firstPinnedOrRecent(page)).toContainText('Toggle sidebar')
  await closePanel(page)
}

async function pinSurvivesRestart(page: Page): Promise<void> {
  await openPanel(page)
  await expect(firstPinnedOrRecent(page)).toContainText('Toggle sidebar')
  await closePanel(page)
}

// ---------------------------------------------------------------------------
// After the restart: opening the panel from everywhere, on a plain workspace.
// ---------------------------------------------------------------------------

async function scratchTerminalFocused(page: Page): Promise<void> {
  await createWorkspace(page, 'QA Workspace', e2eTempDir('qa-'))
  await addAndSelectProject(page, 'QA Workspace', 'scratch')
  await page.locator('.terminal-pane').filter({ visible: true }).click()
  await expectTerminalFocused(page)
}

// AC1: a focused terminal, Home; AC16: the band's button.
async function opensFromTerminalHomeAndButton(page: Page): Promise<void> {
  await openPanel(page)
  await closePanel(page)
  await page.getByRole('button', { name: /^Home/ }).click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
  await openPanel(page)
  await closePanel(page)
  await projectGroup(page, 'scratch').click()
  await expectTerminalFocused(page)
  await page.locator('button[aria-label="Quick actions (⌘P)"]').click()
  await expect(dialog(page)).toBeVisible()
  await closePanel(page)
}

// AC2 + AC14: ⌘P t d splits the pane, closes the panel, and teaches ⌘D.
async function leaderTDSplitsAndTeachesShortcut(page: Page): Promise<void> {
  await expect(page.locator('.xterm').filter({ visible: true })).toHaveCount(1)
  await openPanel(page)
  await page.keyboard.press('t')
  await page.keyboard.press('d')
  await expect(dialog(page)).toBeHidden()
  await expect(page.locator('.xterm').filter({ visible: true })).toHaveCount(2)
  await expect(page.locator('.tmui-toast__message', { hasText: 'Next time' })).toContainText(
    'Next time: ⌘D'
  )
}

// AC3: `/` then "push" surfaces Git's Push action through its category.
async function slashSearchFindsPush(page: Page): Promise<void> {
  await openPanel(page)
  await page.keyboard.press('/')
  await expect(page.getByRole('combobox', { name: 'Search quick actions' })).toBeVisible()
  await page.keyboard.type('push')
  await expect(page.getByRole('option', { name: /Push/ })).toBeVisible()
  await closePanel(page)
}

async function aroundAPlainWorkspace(page: Page): Promise<void> {
  await scratchTerminalFocused(page)
  await test.step('⌘P opens the panel from a focused terminal and from Home; the band button opens it too', () =>
    opensFromTerminalHomeAndButton(page))
  await test.step('⌘P t d splits the focused pane, closes the panel, and shows "Next time: ⌘D"', () =>
    leaderTDSplitsAndTeachesShortcut(page))
  await test.step('`/` then typing "push" lists an option whose name contains "Push"', () =>
    slashSearchFindsPush(page))
}

// ---------------------------------------------------------------------------
// In a repository: Git push against a real bare remote, and a custom shell action.
// ---------------------------------------------------------------------------

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

/** A repository with a commit its origin does not have yet, for Push to push. */
function repositoryAheadOfOrigin(): string {
  const bareDir = e2eTempDir('qa-bare-')
  const workDir = e2eTempDir('qa-work-')
  git(bareDir, 'init', '--bare', '-b', 'main')
  git(workDir, 'init', '-b', 'main')
  git(workDir, 'config', 'user.email', 'e2e@example.com')
  git(workDir, 'config', 'user.name', 'E2E')
  git(workDir, 'remote', 'add', 'origin', bareDir)
  git(workDir, 'commit', '--allow-empty', '-m', 'root')
  git(workDir, 'push', '-u', 'origin', 'main')
  git(workDir, 'commit', '--allow-empty', '-m', 'second')
  return workDir
}

async function repositoryFocused(page: Page, workDir: string): Promise<void> {
  await createWorkspace(page, 'QA Git Workspace', workDir)
  await projectGroup(page, 'main').click()
  await expect(page.locator('.tab-bar__tab--session.tab-bar__tab--active')).toBeVisible()
  await page.locator('.terminal-pane').filter({ visible: true }).click()
  await expectTerminalFocused(page)
}

// AC7 (part): the real push, verified against the remote.
async function gitPushCatchesOriginUp(page: Page, workDir: string): Promise<void> {
  const headBefore = git(workDir, 'rev-parse', 'HEAD')
  expect(headBefore).not.toBe(git(workDir, 'rev-parse', 'origin/main'))
  await openPanel(page)
  await page.keyboard.press('g')
  await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
  await expect(page.getByRole('option', { name: /^p Push/ })).toBeVisible()
  await page.keyboard.press('p')
  await expect(dialog(page)).toBeHidden()
  await expect(page.locator('.tmui-toast__message', { hasText: 'Pushed' })).toContainText(
    'Pushed main to origin'
  )
  git(workDir, 'fetch', 'origin')
  expect(git(workDir, 'rev-parse', 'origin/main')).toBe(headBefore)
}

/** Adds, in Settings, the "Echo branch" action on `x e`, which writes the branch to `echoed`. */
async function addEchoBranchAction(page: Page, echoed: string): Promise<void> {
  await page.keyboard.press('ControlOrMeta+,')
  await expect(page.locator('.settings-panel')).toBeVisible()
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

// AC10: a custom shell action with a variable, targeting a new tab. tee: the WebGL renderer
// draws to a canvas, so the branch also goes to a file the test can read.
async function customShellActionEchoesBranch(page: Page, workDir: string): Promise<void> {
  const echoed = join(workDir, 'echoed-branch.txt')
  await addEchoBranchAction(page, echoed)
  const tabs = page.locator('.tab-bar__tab--session')
  const tabsBefore = await tabs.count()
  await openPanel(page)
  await page.keyboard.press('x')
  await page.keyboard.press('e')
  await expect(dialog(page)).toBeHidden()
  await expect(tabs).toHaveCount(tabsBefore + 1)
  await expect
    .poll(() => (existsSync(echoed) ? readFileSync(echoed, 'utf8').trim() : ''), {
      message: 'the new tab never echoed the branch name',
    })
    .toBe('main')
}

/** The panel opened, then its Git group, captured once the fade-in (QuickActions.css) has finished. */
async function capturePanel(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await setTheme(page, theme)
  await openPanel(page)
  await waitForAnimationsToFinish(page, '.qa-panel')
  await page.screenshot({ path: `test-results/quick-actions/panel-top-${theme}.png` })
  await page.keyboard.press('g')
  await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
  await waitForAnimationsToFinish(page, '.qa-panel')
  await page.screenshot({ path: `test-results/quick-actions/panel-git-${theme}.png` })
  await closePanel(page)
}

async function inARepository(page: Page): Promise<void> {
  const workDir = repositoryAheadOfOrigin()
  await repositoryFocused(page, workDir)
  await test.step('Git Push runs in the focused worktree, and origin/main catches up to HEAD', () =>
    gitPushCatchesOriginUp(page, workDir))
  await test.step('a custom shell action "echo {branch}" targeting a new tab writes the branch to the terminal', () =>
    customShellActionEchoesBranch(page, workDir))
  await test.step('the panel and the Git group are captured in dark and light themes', async () => {
    await capturePanel(page, 'dark')
    await capturePanel(page, 'light')
  })
}

// ---------------------------------------------------------------------------
// Extensions: their manifest commands, and the leader from inside their views.
// ---------------------------------------------------------------------------

/** Opens the panel, runs the row `rowKey` of the group `groupKey` (listed as `groupLabel`), and
 * waits for the panel to close. The mnemonic listener is rebound on every mode change
 * (QuickActions.tsx), so the row's key goes only once the group's listbox has rendered. */
async function runGroupRow(
  page: Page,
  group: { key: string; label: string },
  rowKey: string
): Promise<void> {
  await openPanel(page)
  await page.keyboard.press(group.key)
  await expect(page.getByRole('listbox', { name: group.label })).toBeVisible()
  await page.keyboard.press(rowKey)
  // Generous: the first time an extension's view is created it can cold-load.
  await expect(dialog(page)).toBeHidden()
}

// AC6: Notepad's and Task Vault's manifest commands.
async function extensionCommandsOpenTheirOverlays(handle: AppHandle): Promise<void> {
  await runGroupRow(handle.page, { key: 'n', label: 'Notes' }, 'n')
  await expect
    .poll(
      () =>
        inView<boolean>(
          handle,
          'notepad',
          `!!document.querySelector('dialog[open][aria-label="New note"]')`
        ).catch(() => false),
      { message: 'Notepad quick-create overlay never appeared' }
    )
    .toBe(true)
  await runGroupRow(handle.page, { key: 'v', label: 'Task Vault' }, 'c')
  await expect
    .poll(() => inView<string>(handle, 'task-vault', `document.body.innerText`).catch(() => ''), {
      message: 'Task Vault capture overlay never appeared',
    })
    .toContain('Capture to Inbox')
}

/** Notes brought forward, its frame loaded and owning focus, so its listeners see the key. */
async function notesViewFocused(handle: AppHandle): Promise<void> {
  const notesPanel = handle.page.locator('[data-extension-panel="terminator.notepad"]')
  if ((await notesPanel.count()) === 0)
    await handle.page.locator('button[aria-label="Notes"]').click()
  await expect(notesPanel).toHaveCount(1)
  await expect
    .poll(
      () =>
        extensionFrame(handle, 'notepad')
          ?.evaluate(() => document.readyState === 'complete')
          .catch(() => false) ?? false
    )
    .toBe(true)
  await extensionFrame(handle, 'notepad')!.evaluate(() => (document.body as HTMLElement).focus())
}

// AC1 + AC15: the leader from inside an extension view, and Escape closing only the panel.
async function leaderInsideNotesOpensPanel(handle: AppHandle): Promise<void> {
  const { page } = handle
  const notesPanel = page.locator('[data-extension-panel="terminator.notepad"]')
  await notesViewFocused(handle)
  await page.keyboard.press('ControlOrMeta+p')
  await expect(dialog(page)).toBeVisible()
  // Escape pressed before focus has moved into the panel from the extension's view closes nothing.
  await expect(dialog(page).locator(':focus')).toHaveCount(1)
  await closePanel(page)
  await expect(notesPanel).toHaveCount(1)
  // A second Escape close on the heels of the first must not read as a double-Escape exit.
  await page.keyboard.press('Escape')
  await expect(notesPanel).toHaveCount(1)
}

async function withExtensions(handle: AppHandle): Promise<void> {
  await test.step('⌘P n n shows the Notepad quick-create overlay, and ⌘P v c the Task Vault capture', () =>
    extensionCommandsOpenTheirOverlays(handle))
  await test.step('⌘P from inside the Notes view opens the panel; Escape closes only the panel', () =>
    leaderInsideNotesOpensPanel(handle))
}

test('Quick Actions drive the app from anywhere, and remember what was pinned', async () => {
  let handle: AppHandle | undefined = await launchApp()
  try {
    const profile = handle.userDataDir
    const firstPage = handle.page
    await test.step('Git Push is dimmed with a reason and does not run with no repository focused', () =>
      gitPushDimmedWithoutRepository(firstPage))
    await test.step('an action run 3 times appears in Recent, and pinning puts it first', () =>
      recentThenPinned(firstPage))
    await closeApp(handle)
    handle = undefined
    handle = await launchApp(profile)
    const { page } = handle
    await test.step('the pin survives a restart', () => pinSurvivesRestart(page))
    await aroundAPlainWorkspace(page)
    await inARepository(page)
    await withExtensions(handle)
  } finally {
    await closeApp(handle)
  }
})
