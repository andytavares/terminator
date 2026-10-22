import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, workspaceRow } from './helpers'

// Sort and drag-to-reorder both shipped broken under green unit tests: the drop wrote an order
// the view model then re-sorted alphabetically on every render. Only the running app shows it.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

const repoOrder = (): Promise<string[]> =>
  handle.page.locator('.repo-header__name').allTextContents()

const branchOrder = (): Promise<string[]> =>
  handle.page.locator('.branch-row__name').allTextContents()

const displayButton = () => handle.page.getByRole('button', { name: 'Display' })

async function addBranch(workspaceName: string, branchName: string): Promise<void> {
  const { page } = handle
  await workspaceRow(page, workspaceName).hover()
  await workspaceRow(page, workspaceName)
    .locator(`.repo-header__action[aria-label="New branch in ${workspaceName}"]`)
    .click()
  await page.getByPlaceholder('My branch').fill(branchName)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(page.locator('.branch-row__name', { hasText: branchName })).toBeVisible()
}

/** Created in an order the alphabet disagrees with, so "stored order" and "alphabetical" can
 * never be mistaken for one another. */
async function reposAndBranchesOutOfAlphabeticalOrder(): Promise<void> {
  const { page, userDataDir } = handle
  await createWorkspace(page, 'Zulu', userDataDir)
  await createWorkspace(page, 'Alpha', userDataDir)
  await addBranch('Zulu', 'z-branch')
  await addBranch('Zulu', 'a-branch')
  await addBranch('Alpha', 'a-only')
}

async function pickSort(label: string): Promise<void> {
  await displayButton().click()
  await handle.page.locator('.sidebar-menu__item', { hasText: new RegExp(`^${label}$`) }).click()
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

/** The panel is wider than the button's room in a narrow sidebar, so it reaches past the
 * sidebar's edge; there it must be drawn over the pane beside it. */
async function displayMenuOffersEveryGroupingAndSort(): Promise<void> {
  const { page } = handle
  await displayButton().click()
  for (const name of ['Workspace', 'None', 'Recent', 'Name']) {
    await expect(page.getByRole('menuitemradio', { name })).toBeVisible()
  }
  const sidebar = page.locator('.unified-sidebar')
  const width = await sidebar.evaluate((element: HTMLElement) => element.style.width)
  await sidebar.evaluate((element: HTMLElement) => (element.style.width = '200px'))
  expect(await page.evaluate(menuPastSidebar)).toEqual({ overhangs: true, onTop: true })
  await sidebar.evaluate((element: HTMLElement, before) => (element.style.width = before), width)
  await page.keyboard.press('Escape')
  await page.locator('.unified-sidebar__list').click({ position: { x: 5, y: 5 } })
}

async function filterMenuOffersEveryView(): Promise<void> {
  const { page } = handle
  await page.getByRole('button', { name: /^Filter/ }).click()
  for (const name of [/Everything/, /Needs me/, /Active/, /Stale/]) {
    await expect(page.getByRole('menuitemradio', { name })).toBeVisible()
  }
  await expect(page.getByRole('menuitemcheckbox', { name: /Hide stale/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('.unified-sidebar__list').click({ position: { x: 5, y: 5 } })
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** Was four bands and 165px on the build this replaced; SC-002 asks for a 40% cut, 99px. */
async function atMostTwoBandsOfChrome(): Promise<void> {
  const measured = await handle.page.evaluate(() => {
    const sidebar = document.querySelector('.unified-sidebar')!
    const firstRow = document.querySelector('.repo-header')!
    const bands = document.querySelectorAll(
      '.unified-sidebar > .sidebar-header > *, .unified-sidebar > .view-bar, .unified-sidebar > .filter-notice'
    ).length
    const chrome = firstRow.getBoundingClientRect().top - sidebar.getBoundingClientRect().top
    return { bands, chrome: Math.round(chrome) }
  })
  expect(measured.bands).toBeLessThanOrEqual(2)
  expect(measured.chrome).toBeLessThanOrEqual(99)
}

async function sidebarSaysBranchNeverProject(): Promise<void> {
  const text = (await handle.page.locator('.unified-sidebar').textContent()) ?? ''
  expect(text.toLowerCase()).not.toContain('project')
  // Creating a branch is the repo header's hover control, so its words are an accessible name.
  await expect(
    workspaceRow(handle.page, 'Zulu').getByRole('button', { name: 'New branch in Zulu' })
  ).toHaveCount(1)
}

async function manualIsStoredOrder(): Promise<void> {
  await pickSort('Manual')
  expect(await repoOrder()).toEqual(['Zulu', 'Alpha'])
  expect(await branchOrder()).toEqual(['z-branch', 'a-branch', 'a-only'])
}

async function nameSortReachesRepoHeaders(): Promise<void> {
  await pickSort('Name')
  expect(await repoOrder()).toEqual(['Alpha', 'Zulu'])
  expect(await branchOrder()).toEqual(['a-only', 'a-branch', 'z-branch'])
}

async function draggedRepoOrderSurvivesReload(): Promise<void> {
  const { page } = handle
  // Still sorted by name: the drop has to switch the view to Manual, or the computed sort would
  // recompute over it immediately.
  await page.locator('.repo-header').first().dragTo(page.locator('.repo-header').last())
  await expect(page.locator('.repo-header__name').first()).toHaveText('Zulu')
  await displayButton().click()
  await expect(
    page.locator('.sidebar-menu__item[aria-checked="true"]', { hasText: 'Manual' })
  ).toBeVisible()
  await page.click('.sidebar-search input')
  await page.reload()
  await expect(page.locator('.repo-header__name').first()).toHaveText('Zulu')
}

async function draggedBranchOrderSurvivesReload(): Promise<void> {
  const { page } = handle
  await page
    .locator('.branch-row', { hasText: 'z-branch' })
    .dragTo(page.locator('.branch-row', { hasText: 'a-branch' }))
  await expect(page.locator('.branch-row__name').first()).toHaveText('a-branch')
  await page.reload()
  await expect(page.locator('.branch-row__name').first()).toHaveText('a-branch')
  expect(await branchOrder()).toEqual(['a-branch', 'z-branch', 'a-only'])
}

async function theSidebarIsLaidOut(): Promise<void> {
  await test.step(
    'every view, grouping and sort control lives in two menus, drawn over the pane beside a narrow sidebar (FR-034)',
    displayMenuOffersEveryGroupingAndSort
  )
  await test.step(
    'the Filter menu offers every saved view and the stale toggle',
    filterMenuOffersEveryView
  )
  await test.step(
    'at most two bands of chrome sit above the first row of work (FR-033, SC-002)',
    atMostTwoBandsOfChrome
  )
  await test.step('the sidebar says branch, never project', sidebarSaysBranchNeverProject)
}

async function theSidebarIsSortedAndReordered(): Promise<void> {
  await test.step('Manual is the stored order, for repos as well as branches', manualIsStoredOrder)
  await test.step(
    'sorting by name reaches the repo headers, not just the branches under them',
    nameSortReachesRepoHeaders
  )
  await test.step(
    'dragging a repo writes an order that is actually drawn, and survives a reload',
    draggedRepoOrderSurvivesReload
  )
  await test.step(
    'dragging a branch reorders it within its repo, and survives a reload',
    draggedBranchOrderSurvivesReload
  )
}

test('the sidebar is sorted, filtered and reordered by hand, and keeps the order', async () => {
  await reposAndBranchesOutOfAlphabeticalOrder()
  await theSidebarIsLaidOut()
  await theSidebarIsSortedAndReordered()
})
