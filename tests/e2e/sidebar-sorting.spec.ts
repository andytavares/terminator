import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, workspaceRow } from './helpers'

// The Display menu's sort and the drag-to-reorder both shipped broken, and the
// unit tests were green throughout: they asserted that the drop handler called
// the store, which it did — the order it wrote was simply never drawn, because
// the view model re-sorted the repos alphabetically on every render. Only the
// running app can tell those two apart, so these live here.

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

async function addBranch(workspaceName: string, branchName: string): Promise<void> {
  const { page } = handle
  await workspaceRow(page, workspaceName).hover()
  await workspaceRow(page, workspaceName)
    .locator(`.repo-header__action[aria-label="New branch in ${workspaceName}"]`)
    .click()
  await page.getByPlaceholder('My branch').fill(branchName)
  await page.click('.dialog__btn-primary')
  await expect(page.locator('.branch-row__name', { hasText: branchName })).toBeVisible()
}

async function pickSort(label: string): Promise<void> {
  await handle.page.click('.sidebar-menu__button[aria-label="Display"]')
  await handle.page.locator('.sidebar-menu__item', { hasText: new RegExp(`^${label}$`) }).click()
}

test.beforeAll(async () => {
  const { page, userDataDir } = handle
  // Created in an order the alphabet disagrees with, so "stored order" and
  // "alphabetical" can never be mistaken for one another.
  await createWorkspace(page, 'Zulu', userDataDir)
  await createWorkspace(page, 'Alpha', userDataDir)
  await addBranch('Zulu', 'z-branch')
  await addBranch('Zulu', 'a-branch')
  await addBranch('Alpha', 'a-only')
})

test('Manual is the stored order, for repos as well as branches', async () => {
  await pickSort('Manual')
  expect(await repoOrder()).toEqual(['Zulu', 'Alpha'])
  expect(await branchOrder()).toEqual(['z-branch', 'a-branch', 'a-only'])
})

test('sorting by name reaches the repo headers, not just the branches under them', async () => {
  await pickSort('Name')
  expect(await repoOrder()).toEqual(['Alpha', 'Zulu'])
  expect(await branchOrder()).toEqual(['a-only', 'a-branch', 'z-branch'])
})

test('dragging a repo writes an order that is actually drawn, and survives a restart', async () => {
  const { page } = handle
  // Still sorted by name from the previous test: the drop has to switch the
  // view to Manual, or the computed sort would recompute over it immediately.
  await page.locator('.repo-header').first().dragTo(page.locator('.repo-header').last())
  await expect(page.locator('.repo-header__name').first()).toHaveText('Zulu')

  await page.click('.sidebar-menu__button[aria-label="Display"]')
  await expect(
    page.locator('.sidebar-menu__item[aria-checked="true"]', { hasText: 'Manual' })
  ).toBeVisible()
  await page.click('.sidebar-search input')

  await page.reload()
  await page.waitForSelector('.repo-header')
  await expect(page.locator('.repo-header__name').first()).toHaveText('Zulu')
})

test('dragging a branch reorders it within its repo, and survives a restart', async () => {
  const { page } = handle
  await page
    .locator('.branch-row', { hasText: 'z-branch' })
    .dragTo(page.locator('.branch-row', { hasText: 'a-branch' }))
  await expect(page.locator('.branch-row__name').first()).toHaveText('a-branch')

  await page.reload()
  await page.waitForSelector('.branch-row')
  expect(await branchOrder()).toEqual(['a-branch', 'z-branch', 'a-only'])
})
