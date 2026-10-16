import { test, expect, type Locator } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  selectProject,
  e2eTempDir,
  projectGroup,
  workspaceRow,
  runQuickActionFromPanel,
  readTerminalRowsIn,
  visibleTerminalScreen,
} from './helpers'
import { recordShellOpens, shellOpens } from './main-stubs'
import { expectCentredInWindow } from './modal-centre'

// Terminals from an operator's side: opened, navigated, split, followed and closed. The three
// flows share one app; each makes its own workspace, so none depends on another having run.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  await recordShellOpens(handle.app)
})

test.afterAll(async () => {
  await closeApp(handle)
})

const sessionTabs = () => handle.page.locator('.tab-bar__tab--session')
const visibleScreens = () =>
  handle.page.locator('.terminal-pane .xterm-screen').filter({ visible: true })

/** A workspace over a new plain folder, with one branch selected; returns the folder. */
async function workspaceWithBranch(workspace: string, branch: string): Promise<string> {
  const folder = e2eTempDir('terminator-e2e-terminal-')
  await createWorkspace(handle.page, workspace, folder)
  await addAndSelectProject(handle.page, workspace, branch)
  return folder
}

// ── Flow 1: opened, navigated and closed ────────────────────────────────────

/** True when the live terminal is scrolled to (or within a line of) the bottom.
 * xterm 6 scrolls virtually (the `.xterm-viewport` element has no scroll offset), so this
 * reads the vertical scrollbar slider: its bottom edge sits at the track's bottom edge. */
function viewportAtBottom(): Promise<boolean> {
  return handle.page.evaluate(() => {
    const track = document.querySelector(
      '.terminal-pane .xterm-scrollable-element > .scrollbar.vertical'
    ) as HTMLElement | null
    const slider = track?.querySelector('.slider') as HTMLElement | null
    if (!track || !slider) return false
    return track.getBoundingClientRect().bottom - slider.getBoundingClientRect().bottom < 5
  })
}

async function terminalFollowsOutput(): Promise<void> {
  const { page } = handle
  await workspaceWithBranch('WS-Persist-A', 'Proj-A')
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
  await page.locator('.terminal-pane').click()
  await page.keyboard.type('seq 1 300')
  await page.keyboard.press('Enter')
  await expect.poll(viewportAtBottom, { timeout: 8000 }).toBe(true)
}

/** The persist-on-tab-switch architecture (ADR-004) moves the xterm element between
 * containers, which resets the DOM viewport's scrollTop while xterm's own position stays at the
 * bottom; the terminal must re-pin to its latest output on reattach. */
async function terminalStaysAtBottomAcrossSwitch(): Promise<void> {
  await workspaceWithBranch('WS-Persist-B', 'Proj-B')
  await selectProject(handle.page, 'WS-Persist-A', 'Proj-A')
  await expect.poll(viewportAtBottom, { timeout: 8000 }).toBe(true)
}

async function terminalsSurviveSwitchingWorkspaces(): Promise<void> {
  const { page } = handle
  await page.keyboard.press('ControlOrMeta+t')
  await expect(sessionTabs()).toHaveCount(2)
  await selectProject(page, 'WS-Persist-B', 'Proj-B')
  await expect(sessionTabs()).toHaveCount(1)
  await selectProject(page, 'WS-Persist-A', 'Proj-A')
  await expect(sessionTabs()).toHaveCount(2)
}

async function cmdOneExpandsFirstWorkspace(): Promise<void> {
  await handle.page.keyboard.press('ControlOrMeta+1')
  await expect(projectGroup(handle.page, 'Proj-A')).toBeVisible()
}

async function cmdArrowRightMovesToNextTab(): Promise<void> {
  await selectProject(handle.page, 'WS-Persist-A', 'Proj-A')
  await sessionTabs().first().click()
  await expect(sessionTabs().first()).toHaveClass(/tab-bar__tab--active/)
  await handle.page.keyboard.press('ControlOrMeta+ArrowRight')
  await expect(sessionTabs().first()).not.toHaveClass(/tab-bar__tab--active/)
}

async function severalTabsStayResponsive(): Promise<void> {
  const { page } = handle
  for (let opened = 3; opened <= 5; opened++) {
    await page.keyboard.press('ControlOrMeta+t')
    await expect(sessionTabs()).toHaveCount(opened)
  }
  await sessionTabs().first().click()
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
  await sessionTabs().last().click()
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
  await expect(workspaceRow(page, 'WS-Persist-A')).toBeVisible()
}

async function closingTabRemovesIt(): Promise<void> {
  await handle.page.locator('.tab-bar__close').last().click()
  await expect(sessionTabs()).toHaveCount(4)
}

async function backgroundTerminalsSurviveNavigation(): Promise<void> {
  await selectProject(handle.page, 'WS-Persist-B', 'Proj-B')
  await expect(sessionTabs()).toHaveCount(1)
  await selectProject(handle.page, 'WS-Persist-A', 'Proj-A')
  await expect(sessionTabs()).toHaveCount(4)
}

async function moveToBranchOpensCentred(): Promise<void> {
  const { page } = handle
  await sessionTabs().first().click({ button: 'right' })
  await page.locator('.ctx-menu__item', { hasText: 'Move to branch…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move to branch' })
  await expectCentredInWindow(dialog, 'Move to branch')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
}

/** A worktree removed outside the app, a repo deleted: node-pty used to fork, fail to chdir and
 * exit having printed nothing, so a tab appeared and died with no reason given. */
async function goneFolderSaysSo(): Promise<void> {
  const { page } = handle
  const folder = await workspaceWithBranch('Gone', 'branch-a')
  await expect(sessionTabs()).toHaveCount(1)
  rmSync(folder, { recursive: true, force: true })
  await page.keyboard.press('ControlOrMeta+t')
  // Other toasts can be up too (Foundry's one-time records notice, say).
  const toast = page.locator('.tmui-toast__message', { hasText: 'no longer exists' })
  await expect(toast).toContainText(folder)
  // No second tab, and nothing marked [exited]: the terminal never opened.
  await expect(sessionTabs()).toHaveCount(1)
  await expect(sessionTabs()).not.toContainText('[exited]')
}

async function terminalsOpenAndFollow(): Promise<void> {
  await test.step('a terminal follows its output to the bottom', terminalFollowsOutput)
  await test.step(
    'it is still at the bottom after its branch is left and reselected',
    terminalStaysAtBottomAcrossSwitch
  )
  await test.step(
    'a branch keeps its terminals while another workspace is used',
    terminalsSurviveSwitchingWorkspaces
  )
  await test.step('⌘1 expands the first workspace', cmdOneExpandsFirstWorkspace)
  await test.step('⌘→ moves to the next tab', cmdArrowRightMovesToNextTab)
}

async function terminalsAreManaged(): Promise<void> {
  await test.step(
    '⌘T opens tabs, and with several open, switching tabs keeps a pane mounted',
    severalTabsStayResponsive
  )
  await test.step('closing a tab removes it from the tab bar', closingTabRemovesIt)
  await test.step(
    'background terminals are still there after navigating away and back',
    backgroundTerminalsSurviveNavigation
  )
  await test.step('Move to branch opens in the middle of the window', moveToBranchOpensCentred)
  await test.step(
    'a branch whose folder is gone says so instead of opening a dead terminal',
    goneFolderSaysSo
  )
}

test('terminals are opened, followed, navigated and closed across branches', async () => {
  test.setTimeout(120_000)
  await terminalsOpenAndFollow()
  await terminalsAreManaged()
})

// ── Flow 2: split ───────────────────────────────────────────────────────────

const splitBranch = () => projectGroup(handle.page, 'panes')
const terminalRows = () => handle.page.locator('.terminal-row')

/** Splitting worked, but the pane it made existed on screen and nowhere else: the sidebar
 * stopped at the branch, and the only way out was an invisible ⌘W. */
async function splitPaneIsListedAndHideable(): Promise<void> {
  await handle.page.keyboard.press('ControlOrMeta+d')
  await expect(visibleScreens()).toHaveCount(2, { timeout: 15000 })
  const disclosure = splitBranch().locator('.branch-row__disclosure')
  await expect(disclosure, 'a branch with terminals offers a disclosure').toBeVisible()
  // Collapsed by default: the sidebar still stops at the branch until asked.
  await expect(terminalRows()).toHaveCount(0)
  await disclosure.click()
  await expect(terminalRows()).toHaveCount(2, { timeout: 10000 })
  // The pane is nested under its root, not a sibling of it.
  await expect(terminalRows().nth(0)).not.toHaveClass(/terminal-row--nested/)
  await expect(terminalRows().nth(1)).toHaveClass(/terminal-row--nested/)
  await disclosure.click()
  await expect(terminalRows()).toHaveCount(0)
}

/** Run in the page: where each level of the open tree starts. */
function treeDepths(): Record<'repo' | 'branch' | 'terminal' | 'pane', number> {
  const left = (selector: string) =>
    Math.round(document.querySelector(selector)?.getBoundingClientRect().left ?? -1)
  return {
    repo: left('.repo-header__chevron'),
    branch: left('.branch-row__disclosure'),
    terminal: left('.terminal-row__gutter'),
    pane: left('.terminal-row--nested .terminal-row__gutter'),
  }
}

async function treeStepsInAtEveryLevel(): Promise<void> {
  await splitBranch().locator('.branch-row__disclosure').click()
  await expect(terminalRows()).toHaveCount(2, { timeout: 10000 })
  const depths = await handle.page.evaluate(treeDepths)
  // Each level sits to the right of the one above it; without this a pane read as a sibling of
  // the branch rather than as something inside it.
  expect(depths.repo).toBeLessThan(depths.branch)
  expect(depths.branch).toBeLessThan(depths.terminal)
  expect(depths.terminal).toBeLessThan(depths.pane)
}

async function paneClosesFromSidebar(): Promise<void> {
  await expect(handle.page.locator('.leaf-pane__close').filter({ visible: true })).toHaveCount(2)
  await terminalRows().last().locator('.terminal-row__close').click({ force: true })
  await expect(terminalRows(), 'closing the pane removes its row').toHaveCount(1)
  // One pane left means no split, so no per-pane titlebars either.
  await expect(visibleScreens()).toHaveCount(1, { timeout: 10000 })
  await splitBranch().locator('.branch-row__disclosure').click()
}

async function newTabBesideSplitTakesKeys(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'Split down')
  await expect(visibleScreens()).toHaveCount(2, { timeout: 15000 })
  await runQuickActionFromPanel(page, 'New tab')
  await expect(sessionTabs()).toHaveCount(2)
  await expect(sessionTabs().last()).toHaveClass(/tab-bar__tab--active/)
  await expect(visibleScreens()).toHaveCount(1, { timeout: 15000 })
  await page.keyboard.type('echo typed-into-new-tab')
  await page.keyboard.press('Enter')
  const visibleRows = async () => (await readTerminalRowsIn(visibleScreens().first())).join('\n')
  await expect.poll(visibleRows).toContain('typed-into-new-tab')
}

async function firstTabShowsItsSplitAgain(): Promise<void> {
  await sessionTabs().first().click()
  await expect(visibleScreens()).toHaveCount(2, { timeout: 15000 })
  for (const screen of await visibleScreens().all()) {
    expect((await readTerminalRowsIn(screen)).join('\n')).not.toContain('typed-into-new-tab')
  }
}

test('a terminal is split, its pane listed, reached and closed, and the split kept per tab', async () => {
  test.setTimeout(90_000)
  await workspaceWithBranch('Split', 'panes')
  await test.step(
    'a split pane is listed under the terminal it came from, and can be hidden',
    splitPaneIsListedAndHideable
  )
  await test.step('the tree steps in at every level', treeStepsInAtEveryLevel)
  await test.step('a pane has its own close, and closes from the sidebar', paneClosesFromSidebar)
  await test.step(
    'New tab after Split down shows the new terminal, and typing reaches it',
    newTabBesideSplitTakesKeys
  )
  await test.step('going back to the first tab shows its split again', firstTabShowsItsSplitAgain)
})

// ── Flow 3: links, the bell and a plain branch's name ───────────────────────

/** Prints `line` alone on a row of the pane's `.xterm-screen` and ⌘-clicks (Ctrl off macOS)
 * its first characters. xterm sizes the screen to exactly its rows, so a row is the
 * screen's height over the number of rows. */
async function printAndModClick(screen: Locator, line: string): Promise<void> {
  const page = screen.page()
  await screen.click()
  await page.keyboard.type(`printf '%s\\n' '${line}'`)
  await page.keyboard.press('Enter')
  const rowsOfLine = async () =>
    (await readTerminalRowsIn(screen)).filter((row) => row.startsWith(line)).length
  await expect.poll(rowsOfLine).toBe(1)
  const rows = await readTerminalRowsIn(screen)
  const index = rows.findIndex((row) => row.startsWith(line))
  const box = (await screen.boundingBox())!
  const modifier = process.platform === 'darwin' ? 'Meta' : 'Control'
  await page.keyboard.down(modifier)
  await page.mouse.click(box.x + 20, box.y + ((index + 0.5) * box.height) / rows.length)
  await page.keyboard.up(modifier)
}

async function renameRenamesPlainBranch(): Promise<void> {
  const { page } = handle
  await projectGroup(page, 'scratchpad').click({ button: 'right' })
  await page.locator('.ctx-menu__item', { hasText: 'Rename' }).click()
  const input = page.locator('.branch-row__rename')
  await input.fill('notebook')
  await input.press('Enter')
  await expect(projectGroup(page, 'notebook')).toBeVisible()
  await page.reload()
  await expect(projectGroup(page, 'notebook')).toBeVisible()
}

async function urlOpensOnModClick(): Promise<void> {
  const { page, app } = handle
  await projectGroup(page, 'notebook').click()
  // Two terminals on screen, so the click has to find the row in the right one.
  await runQuickActionFromPanel(page, 'Split down')
  await expect(visibleScreens()).toHaveCount(2, { timeout: 15000 })
  await printAndModClick(visibleScreens().last(), 'https://example.com/e2e-link')
  await expect.poll(() => shellOpens(app)).toContain('https://example.com/e2e-link')
}

async function filePathOpensOnModClick(folder: string): Promise<void> {
  const file = join(folder, 'notes.txt')
  writeFileSync(file, 'hello')
  await printAndModClick(visibleTerminalScreen(handle.page), file)
  await expect.poll(() => shellOpens(handle.app)).toContain(file)
}

async function bellNotifiesAndRevealsTab(): Promise<void> {
  const { page } = handle
  await runQuickActionFromPanel(page, 'New tab')
  await page.keyboard.type("sleep 2; printf '\\a'")
  await page.keyboard.press('Enter')
  await sessionTabs().first().click()
  const bell = page.locator('.app-band__entry[aria-label^="Notifications"]')
  await expect(bell).toHaveAttribute('aria-label', /unread/, { timeout: 15000 })
  await bell.click()
  await page.locator('.notif-item', { hasText: 'needs attention' }).first().click()
  await expect(sessionTabs().last()).toHaveClass(/tab-bar__tab--active/)
}

async function dismissRemovesNotification(): Promise<void> {
  const { page } = handle
  await page.locator('.app-band__entry[aria-label^="Notifications"]').click()
  const before = await page.locator('.notif-item').count()
  await page.locator('.notif-item__dismiss').first().click()
  await expect(page.locator('.notif-item')).toHaveCount(before - 1)
  const listed = await page.evaluate(() => window.electronAPI.notifications.list())
  expect(listed.length).toBe(before - 1)
  await page.keyboard.press('Escape')
  await expect(page.locator('.notif-item')).toHaveCount(0)
}

test("a terminal's links open outside the app, its bell notifies, and a plain branch is renamed", async () => {
  test.setTimeout(90_000)
  const folder = await workspaceWithBranch('Plain', 'scratchpad')
  await test.step(
    'Rename renames a branch that no git branch names, and the name survives a reload',
    renameRenamesPlainBranch
  )
  await test.step(
    'a URL in a terminal opens in the browser on ⌘-click (Ctrl-click off macOS)',
    urlOpensOnModClick
  )
  await test.step('a file path in a terminal opens in its app on ⌘-click', () =>
    filePathOpensOnModClick(folder))
  await test.step(
    'a bell in a background tab notifies, and clicking the notification reveals the tab',
    bellNotifiesAndRevealsTab
  )
  await test.step('× dismisses a notification', dismissRemovesNotification)
})
