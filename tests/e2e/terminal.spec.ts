import { test, expect } from '@playwright/test'
import { rmSync } from 'node:fs'
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
} from './helpers'
import { expectCentredInWindow } from './modal-centre'
import { openOverview, runInVisibleTerminal } from './session-views'

// Terminals from an operator's side: opened, navigated, split, followed and closed. The two
// flows share one app; each makes its own workspace, so none depends on another having run.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
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
  await runInVisibleTerminal(page, 'seq 1 300')
  await expect.poll(viewportAtBottom).toBe(true)
}

/** The persist-on-tab-switch architecture (ADR-004) moves the xterm element between
 * containers, which resets the DOM viewport's scrollTop while xterm's own position stays at the
 * bottom; the terminal must re-pin to its latest output on reattach. */
async function terminalStaysAtBottomAcrossSwitch(): Promise<void> {
  await workspaceWithBranch('WS-Persist-B', 'Proj-B')
  await selectProject(handle.page, 'WS-Persist-A', 'Proj-A')
  await expect.poll(viewportAtBottom).toBe(true)
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
  await terminalsOpenAndFollow()
  await terminalsAreManaged()
})

// ── Flow 2: a split terminal, in the sidebar and on the Overview wall ───────

const splitBranch = () => projectGroup(handle.page, 'panes')
const terminalRows = () => handle.page.locator('.terminal-row')

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

/** Only a laid-out window shows the indent; the renderer tests cover what is listed and nested. */
async function paneStepsInUnderItsTerminal(): Promise<void> {
  const { page } = handle
  await page.keyboard.press('ControlOrMeta+d')
  await expect(visibleScreens()).toHaveCount(2)
  await splitBranch().locator('.branch-row__disclosure').click()
  await expect(terminalRows()).toHaveCount(2)
  const depths = await page.evaluate(treeDepths)
  // Each level sits to the right of the one above it; without this a pane read as a sibling of
  // the branch rather than as something inside it.
  expect(depths.repo).toBeLessThan(depths.branch)
  expect(depths.branch).toBeLessThan(depths.terminal)
  expect(depths.terminal).toBeLessThan(depths.pane)
}

const PROBE = 'SPACING-PROBE-0123456789'

/** Run in the page: the probe row's drawn width, and the width of the same text set in its font. */
function probeWidths(text: string): { drawn: number; expected: number } | null {
  const row = [...document.querySelectorAll('.live-preview .xterm-rows > div')].find((r) =>
    r.textContent?.includes(text)
  )
  if (!(row instanceof HTMLElement)) return null
  const scale = row.getBoundingClientRect().width / row.offsetWidth
  const range = document.createRange()
  range.selectNodeContents(row.firstElementChild ?? row)
  const reference = document.createElement('span')
  reference.style.cssText = 'position:absolute;white-space:pre;visibility:hidden'
  const { fontFamily, fontSize } = getComputedStyle(row)
  Object.assign(reference.style, { fontFamily, fontSize })
  reference.textContent = row.textContent
  document.body.appendChild(reference)
  const expected = reference.getBoundingClientRect().width
  reference.remove()
  return { drawn: range.getBoundingClientRect().width / scale, expected }
}

/** A tile is the DOM renderer, which measures glyphs when it is built. The probe's terminal is on
 * a branch that is not on screen, so it built that renderer while detached. */
async function wallDrawsNoGapsBetweenLetters(): Promise<void> {
  const { page } = handle
  await openOverview(page)
  await expect.poll(() => page.evaluate(probeWidths, PROBE)).not.toBeNull()
  const widths = (await page.evaluate(probeWidths, PROBE))!
  expect(widths.drawn).toBeCloseTo(widths.expected, -1)
}

test('a split terminal is listed a step in under its branch, and drawn on the wall without gaps', async () => {
  await workspaceWithBranch('Split', 'probe')
  await runInVisibleTerminal(handle.page, `echo ${PROBE}`)
  await addAndSelectProject(handle.page, 'Split', 'panes')
  await test.step('the sidebar draws each level of the tree a step in', paneStepsInUnderItsTerminal)
  await test.step(
    'the wall draws a terminal from another branch with no gaps between letters',
    wallDrawsNoGapsBetweenLetters
  )
})
