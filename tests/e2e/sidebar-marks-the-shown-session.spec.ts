import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchApp, closeApp, createWorkspace, e2eTempDir, projectGroup } from './helpers'
import type { AppHandle } from './helpers'
import { openHome } from './session-views'

// The sidebar marks one row, the session the main area shows, and a row's menu is drawn whole.
// Both were wrong in the running app while unit tests passed: a terminal stayed marked after
// another repo came on screen, and Home's containment clipped the ⋯ menu at the column edge.

/** A repository with one commit on main, so its branch row is named main. */
function gitFolder(): string {
  const folder = e2eTempDir('shown-session-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git(
    '-c',
    'user.name=Demo',
    '-c',
    'user.email=demo@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'Start'
  )
  return folder
}

const marked = (page: Page) => page.locator('.unified-sidebar [aria-current="true"]')

/** Opens the newest repo's main branch: the last "main" row, as each repo adds one. */
async function openNewestMain(page: Page, repo: string): Promise<void> {
  await projectGroup(page, 'main').click()
  await expect(page.locator('.tab-bar__scope')).toContainText(repo)
}

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

// Its terminal row listed, as in the report: the row stayed marked once another repo showed.
async function marksTheTerminalOnScreen(page: Page): Promise<void> {
  await createWorkspace(page, 'quicknote', gitFolder())
  await openNewestMain(page, 'quicknote')
  await page.getByRole('button', { name: 'Show terminals in main' }).click()
  await expect(marked(page)).toHaveCount(1)
  await expect(marked(page)).toHaveClass(/terminal-row/)
}

async function marksOnlyTheNewRepo(page: Page): Promise<void> {
  await createWorkspace(page, 'terminator', gitFolder())
  await openNewestMain(page, 'terminator')
  await expect(marked(page)).toHaveCount(1)
}

async function marksNothingUnderHome(page: Page): Promise<void> {
  await openHome(page)
  await expect(marked(page)).toHaveCount(0)
}

async function rowMenuIsDrawnWhole(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Work actions' }).first().click()
  const items = page.locator('.ctx-menu__item')
  await expect(items.first()).toBeVisible()
  const viewport =
    page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  for (const item of await items.all()) {
    const box = (await item.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    // Clipped or covered, the point would hit whatever is drawn there instead.
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.textContent ?? null,
      [box.x + box.width - 4, box.y + box.height / 2]
    )
    expect(hit).toBe(await item.textContent())
  }
}

/** Run in the page: whether the open menu reaches past the sidebar, and is drawn on top there. */
function menuPastSidebar(): { overhangs: boolean; onTop: boolean } {
  const sidebar = document.querySelector('.unified-sidebar')!.getBoundingClientRect()
  const panel = document.querySelector('[role="menu"]')!.getBoundingClientRect()
  const x = sidebar.right + 4
  const y = panel.top + panel.height / 2
  return {
    overhangs: panel.right > x,
    onTop: document.elementFromPoint(x, y)?.closest('[role="menu"]') !== null,
  }
}

/** Run in the page: the height of the chrome above the first repo header. SC-002 allows 99px. */
function chromeAboveFirstRow(): number {
  const sidebar = document.querySelector('.unified-sidebar')!.getBoundingClientRect()
  const firstRow = document.querySelector('.repo-header')!.getBoundingClientRect()
  return Math.round(firstRow.top - sidebar.top)
}

/** The panel is wider than a narrow sidebar, so it reaches past the edge: there it must be drawn
 * over the pane beside it. Chromium resolves anchor() only with position-anchor: auto. */
async function displayMenuIsAnchoredOnTop(page: Page): Promise<void> {
  expect(await page.evaluate(chromeAboveFirstRow)).toBeLessThanOrEqual(99)
  const sidebar = page.locator('.unified-sidebar')
  const width = await sidebar.evaluate((element: HTMLElement) => element.style.width)
  await sidebar.evaluate((element: HTMLElement) => (element.style.width = '200px'))
  const trigger = page.getByRole('button', { name: 'Display', exact: true })
  await trigger.click()
  const menu = page.getByRole('menu', { name: 'Display' })
  await expect(menu).toBeVisible()
  const [menuBox, buttonBox] = await Promise.all([menu.boundingBox(), trigger.boundingBox()])
  expect(menuBox!.y).toBeGreaterThanOrEqual(buttonBox!.y + buttonBox!.height)
  expect(Math.round(menuBox!.x)).toBe(Math.round(buttonBox!.x))
  expect(await page.evaluate(menuPastSidebar)).toEqual({ overhangs: true, onTop: true })
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await sidebar.evaluate((element: HTMLElement, before) => (element.style.width = before), width)
}

test(
  "the sidebar marks only the session on screen, nothing under Home, and draws a row's menu whole",
  { tag: '@mac' },
  async () => {
    const { page } = handle
    await test.step('marks the terminal row of the branch on screen', () =>
      marksTheTerminalOnScreen(page))
    await test.step('marks only the newer repo once it is on screen', () =>
      marksOnlyTheNewRepo(page))
    await test.step('marks nothing under Home', () => marksNothingUnderHome(page))
    await test.step('draws the Display menu under its button, over the pane beside a narrow sidebar', () =>
      displayMenuIsAnchoredOnTop(page))
    await test.step("draws a row's menu whole, on top of everything", () =>
      rowMenuIsDrawnWhole(page))
  }
)
