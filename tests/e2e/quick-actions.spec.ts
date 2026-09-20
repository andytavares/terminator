import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

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
  await page.keyboard.press('Meta+p')
  await expect(dialog(page)).toBeVisible({ timeout: 10000 })
}

/** Run a script inside the first loaded webContents whose URL contains `part`. */
function inView<T>(handle: AppHandle, part: string, script: string): Promise<T> {
  return handle.app.evaluate(
    async ({ webContents }, { p, src }) => {
      const v = webContents
        .getAllWebContents()
        .find((w) => !w.isDestroyed() && w.getURL().includes(p))
      if (!v) throw new Error(`no view for ${p}`)
      return v.executeJavaScript(src) as Promise<unknown>
    },
    { p: part, src: script }
  ) as Promise<T>
}

/** Send a keyDown/char/keyUp triple into an extension's own webContents. */
async function keyInView(
  handle: AppHandle,
  part: string,
  keyCode: string,
  modifiers: string[] = []
): Promise<void> {
  await handle.app.evaluate(
    async ({ webContents }, { p, k, mods }) => {
      const v = webContents
        .getAllWebContents()
        .find((w) => !w.isDestroyed() && w.getURL().includes(p))
      if (!v) throw new Error(`no view for ${p}`)
      v.sendInputEvent({ type: 'keyDown', keyCode: k, modifiers: mods as never })
      if (k.length === 1) v.sendInputEvent({ type: 'char', keyCode: k, modifiers: mods as never })
      v.sendInputEvent({ type: 'keyUp', keyCode: k, modifiers: mods as never })
    },
    { p: part, k: keyCode, mods: modifiers }
  )
}

async function setTheme(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.evaluate(`(async () => {
    await window.electronAPI.settings.updateGlobal({ appearance: { theme: '${theme}' } })
    document.documentElement.setAttribute('data-theme', '${theme}')
  })()`)
  await page.waitForTimeout(300)
}

// ---------------------------------------------------------------------------
// A. Opening and running the panel from a plain (non-git) workspace.
// ---------------------------------------------------------------------------

test.describe('opening and running the panel', () => {
  let handle: AppHandle
  let folder: string

  test.beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'terminator-e2e-qa-'))
    handle = await launchApp()
    await createWorkspace(handle.page, 'QA Workspace', folder)
    await addAndSelectProject(handle.page, 'QA Workspace', 'scratch')
    await handle.page.locator('.xterm').first().click()
    await handle.page.waitForTimeout(500)
  })

  test.afterAll(async () => {
    await closeApp(handle)
    rmSync(folder, { recursive: true, force: true })
  })

  // AC1 (part): a focused terminal.
  test('AC1: ⌘P opens the panel from a focused terminal', async () => {
    const { page } = handle
    await openPanel(page)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })

  // AC1 (part): Home.
  test('AC1: ⌘P opens the panel from Home', async () => {
    const { page } = handle
    await page.getByRole('button', { name: /^Home/ }).click()
    await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
    await openPanel(page)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    // Back to the terminal for the rest of this describe block.
    await handle.page.locator('.branch-row').filter({ hasText: 'scratch' }).click()
    await handle.page.waitForTimeout(500)
  })

  // AC16: the rail button.
  test('AC16: the AppBand "Quick actions (⌘P)" button opens the panel', async () => {
    const { page } = handle
    await page.locator('button[aria-label="Quick actions (⌘P)"]').click()
    await expect(dialog(page)).toBeVisible({ timeout: 10000 })
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })

  // AC2 + AC14: ⌘P t d splits the pane, closes the panel, and teaches ⌘D.
  test('AC2 + AC14: ⌘P t d splits the focused pane, closes the panel, and shows "Next time: ⌘D"', async () => {
    const { page } = handle
    await expect(page.locator('.xterm')).toHaveCount(1)
    await openPanel(page)
    await page.keyboard.press('t')
    await page.keyboard.press('d')
    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('.xterm')).toHaveCount(2, { timeout: 15000 })
    await expect(page.locator('.toast__message')).toContainText('Next time: ⌘D', { timeout: 5000 })
  })

  // AC3: `/` then "push" surfaces Git's Push action through its category.
  test('AC3: `/` then typing "push" lists an option whose name contains "Push"', async () => {
    const { page } = handle
    await openPanel(page)
    await page.keyboard.press('/')
    await expect(page.getByRole('combobox', { name: 'Search quick actions' })).toBeVisible()
    await page.keyboard.type('push')
    await expect(page.getByRole('option', { name: /Push/ })).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })

  // AC6 (part): Notepad's manifest command.
  test('AC6: ⌘P n n shows the Notepad quick-create overlay', async () => {
    const { page } = handle
    await openPanel(page)
    await page.keyboard.press('n')
    await page.keyboard.press('n')
    await expect(dialog(page)).toBeHidden()
    await expect
      .poll(
        async () =>
          inView<boolean>(
            handle,
            'notepad',
            `!!document.querySelector('[role="dialog"][data-tmui-surface]')`
          ).catch(() => false),
        { timeout: 15000, message: 'Notepad quick-create overlay never appeared' }
      )
      .toBe(true)
  })

  // AC6 (part): Task Vault's manifest command.
  test('AC6: ⌘P v c shows the Task Vault capture overlay', async () => {
    const { page } = handle
    await openPanel(page)
    await page.keyboard.press('v')
    await page.keyboard.press('c')
    await expect(dialog(page)).toBeHidden()
    await expect
      .poll(
        async () => inView<string>(handle, 'task-vault', `document.body.innerText`).catch(() => ''),
        { timeout: 15000, message: 'Task Vault capture overlay never appeared' }
      )
      .toContain('Capture to Inbox')
  })

  // AC1 (part) + AC15: the leader from inside an extension view, and Escape
  // closing only the panel — not the extension, and not counted twice.
  test('AC1 + AC15: ⌘P from inside the Notes view opens the panel; Escape closes only the panel', async () => {
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
        () =>
          handle.app.evaluate(({ webContents }) =>
            webContents
              .getAllWebContents()
              .some((wc) => !wc.isDestroyed() && wc.getURL().includes('notepad') && !wc.isLoading())
          ),
        { timeout: 15000 }
      )
      .toBe(true)

    await keyInView(handle, 'notepad', 'P', ['meta'])
    await expect(dialog(page)).toBeVisible({ timeout: 10000 })

    // A single Escape closes only the panel — Notes stays the active surface.
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
    await expect(page.locator('[data-extension-panel="terminator.notepad"]')).toHaveCount(1)

    // A second Escape, close on the heels of the first, must not read as the
    // second half of a double-Escape exit: the panel's own Escape must not
    // have counted toward it.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(500)
    await expect(page.locator('[data-extension-panel="terminator.notepad"]')).toHaveCount(1)
  })
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
    await expect(page.locator('.toast__message')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })
})

// ---------------------------------------------------------------------------
// B. Pins and recent actions survive a relaunch.
// ---------------------------------------------------------------------------

test.describe('pins and recent survive a relaunch', () => {
  let handle: AppHandle

  test.afterAll(async () => {
    await closeApp(handle)
  })

  test('AC8: an action run 3 times appears in Recent; pinning puts it first, and both survive a restart', async () => {
    handle = await launchApp()
    const { page } = handle

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
    await page.keyboard.press('Meta+.')
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
    const userDataDir = handle.userDataDir
    await closeApp(handle, { keepProfile: true })
    handle = await launchApp(userDataDir)

    await openPanel(handle.page)
    await expect(
      handle.page.getByRole('listbox', { name: 'Pinned & recent' }).getByRole('option').first()
    ).toContainText('Toggle sidebar')
  })
})

// ---------------------------------------------------------------------------
// C. Git push against a real bare remote, and a custom shell action.
// ---------------------------------------------------------------------------

test.describe('git push and a custom shell action', () => {
  let handle: AppHandle
  let bareDir: string
  let workDir: string
  const WS = 'QA Git Workspace'

  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  }

  test.beforeAll(async () => {
    bareDir = mkdtempSync(join(tmpdir(), 'terminator-e2e-qa-bare-'))
    workDir = mkdtempSync(join(tmpdir(), 'terminator-e2e-qa-work-'))
    git(bareDir, 'init', '--bare', '-b', 'main')
    git(workDir, 'init', '-b', 'main')
    git(workDir, 'config', 'user.email', 'e2e@example.com')
    git(workDir, 'config', 'user.name', 'E2E')
    git(workDir, 'remote', 'add', 'origin', bareDir)
    git(workDir, 'commit', '--allow-empty', '-m', 'root')
    git(workDir, 'push', '-u', 'origin', 'main')
    // A local commit not yet on the remote, for Push to have something to do.
    git(workDir, 'commit', '--allow-empty', '-m', 'second')

    handle = await launchApp()
    await createWorkspace(handle.page, WS, workDir)
    await handle.page.locator('.branch-row').first().click()
    await handle.page.waitForSelector('.tab-bar__tab--session', { timeout: 15000 })
    await handle.page.waitForTimeout(1000)
  })

  test.afterAll(async () => {
    await closeApp(handle)
    rmSync(bareDir, { recursive: true, force: true })
    rmSync(workDir, { recursive: true, force: true })
  })

  // AC7 (part): the real push, verified against the remote.
  test('AC7: Git Push runs in the focused worktree, and origin/main catches up to HEAD', async () => {
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
    await expect(page.locator('.toast__message')).toContainText('Pushed main to origin', {
      timeout: 15000,
    })

    git(workDir, 'fetch', 'origin')
    expect(git(workDir, 'rev-parse', 'origin/main')).toBe(headBefore)
  })

  // AC10: a custom shell action with a variable, targeting a new tab.
  test('AC10: a custom shell action "echo {branch}" targeting a new tab writes the branch to the terminal', async () => {
    const { page } = handle

    await page.keyboard.press('Meta+,')
    await page.waitForSelector('.settings-panel', { timeout: 5000 })
    await page
      .locator('.settings-section__title', { hasText: 'Quick actions' })
      .scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: 'Add action' }).click()
    await page.locator('#qa-action-label').fill('Echo branch')
    await page.locator('#qa-action-key').fill('e')
    await page.locator('#qa-action-target').selectOption('new-tab')
    await page.locator('#qa-action-body').fill('echo {branch}')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.locator('.qa-settings-list__label', { hasText: 'Echo branch' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.settings-panel')).toBeHidden()

    const tabsBefore = await page.locator('.tab-bar__tab--session').count()

    await openPanel(page)
    await page.keyboard.press('x')
    await page.keyboard.press('e')
    await expect(dialog(page)).toBeHidden()

    await expect(page.locator('.tab-bar__tab--session')).toHaveCount(tabsBefore + 1, {
      timeout: 15000,
    })
    await expect
      .poll(
        async () =>
          page
            .locator('.xterm-rows')
            .last()
            .innerText()
            .catch(() => ''),
        { timeout: 15000, message: 'the new tab never echoed the branch name' }
      )
      .toContain('main')
  })
})

// ---------------------------------------------------------------------------
// D. Screenshots, top level and the Git group, dark and light.
// ---------------------------------------------------------------------------

test.describe('panel screenshots', () => {
  let handle: AppHandle
  let folder: string

  test.beforeAll(async () => {
    folder = mkdtempSync(join(tmpdir(), 'terminator-e2e-qa-shots-'))
    handle = await launchApp()
    await createWorkspace(handle.page, 'QA Shots', folder)
    await addAndSelectProject(handle.page, 'QA Shots', 'scratch')
  })

  test.afterAll(async () => {
    await closeApp(handle)
    rmSync(folder, { recursive: true, force: true })
  })

  test('the panel and the Git group are captured in dark and light themes', async () => {
    const { page } = handle

    // A short settle after each state change: the panel and its overlay fade
    // and scale in over ~120ms, and `toBeVisible` is satisfied well before
    // that finishes — capturing immediately would screenshot mid-transition.
    await setTheme(page, 'dark')
    await openPanel(page)
    await page.waitForTimeout(250)
    await page.screenshot({ path: 'test-results/quick-actions/panel-top-dark.png' })
    await page.keyboard.press('g')
    await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({ path: 'test-results/quick-actions/panel-git-dark.png' })
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()

    await setTheme(page, 'light')
    await openPanel(page)
    await page.waitForTimeout(250)
    await page.screenshot({ path: 'test-results/quick-actions/panel-top-light.png' })
    await page.keyboard.press('g')
    await expect(page.getByRole('listbox', { name: 'Git' })).toBeVisible()
    await page.waitForTimeout(250)
    await page.screenshot({ path: 'test-results/quick-actions/panel-git-light.png' })
    await page.keyboard.press('Escape')
    await expect(dialog(page)).toBeHidden()
  })
})
