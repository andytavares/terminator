import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, e2eTempDir, workspaceRow, projectGroup } from './helpers'
import { answerFolderPicker } from './main-stubs'
import { expectCentredInWindow } from './modal-centre'

// One operator's first minutes: the app opens on Home, a workspace is made over a folder,
// given a branch and some tabs, renamed, and removed again.

let handle: AppHandle
let folder: string
const WS = 'My Test Workspace'
const RENAMED = 'Renamed Workspace'
const BRANCH = 'alpha-project'

test.beforeAll(async () => {
  folder = e2eTempDir('terminator-e2e-workspace-')
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

const sessionTabs = () => handle.page.locator('.tab-bar__tab--session')
const bandEntry = (name: string) =>
  handle.page.locator(`.app-band__entry[aria-label="${name}"]`).first()
const clickSidebarSearch = () => handle.page.getByPlaceholder('Search…').click()
const newBranchButton = () =>
  workspaceRow(handle.page, WS).locator('.repo-header__action[aria-label^="New branch in"]')

async function sidebarRendersPromptly(): Promise<void> {
  await expect(handle.page.locator('.unified-sidebar')).toBeVisible()
}

async function homeClosesOnSidebarClick(): Promise<void> {
  const home = handle.page.getByRole('region', { name: 'Home' })
  await expect(home).toBeVisible()
  await clickSidebarSearch()
  await expect(home).toHaveCount(0)
}

async function overviewClosesOnSidebarClick(): Promise<void> {
  await bandEntry('Overview').click()
  await expect(bandEntry('Overview')).toHaveAttribute('aria-current', 'page')
  await clickSidebarSearch()
  await expect(bandEntry('Overview')).not.toHaveAttribute('aria-current', 'page')
}

async function extensionClosesOnSidebarClick(): Promise<void> {
  await bandEntry('Notes').click()
  await expect(handle.page.locator('[data-extension-panel]')).toHaveCount(1)
  await clickSidebarSearch()
  await expect(handle.page.locator('[data-extension-panel]')).toHaveCount(0)
}

async function createDialogAsksNameFolderColour(): Promise<void> {
  const { page } = handle
  await page.click('.sidebar-header__add')
  const dialog = page.getByRole('dialog', { name: 'Create Workspace' })
  await expectCentredInWindow(dialog, 'Create Workspace')
  await expect(page.getByPlaceholder('My Workspace')).toBeVisible()
  await expect(page.getByPlaceholder('/path/to/folder')).toBeVisible()
  await expect(page.locator('.dialog__colors')).toBeVisible()
  // CreateWorkspaceDialog closes via Cancel/overlay (no Escape handler).
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
}

async function browseFillsTheFolder(): Promise<void> {
  const { page, app } = handle
  await answerFolderPicker(app, folder)
  await page.click('.sidebar-header__add')
  await page.getByPlaceholder('My Workspace').fill(WS)
  await page.getByRole('button', { name: 'Browse' }).click()
  await expect(page.getByPlaceholder('/path/to/folder')).toHaveValue(folder)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
}

async function workspaceAppearsWithColourBand(): Promise<void> {
  const card = workspaceRow(handle.page, WS)
  await expect(card.locator('.repo-header__name')).toContainText(WS)
  await expect(card.locator('.repo-header__swatch')).toBeVisible()
}

async function duplicateNameShowsError(): Promise<void> {
  const { page } = handle
  await page.click('.sidebar-header__add')
  await page.getByPlaceholder('My Workspace').fill(WS)
  // Moving focus to the folder field blurs the name field, which validates and
  // surfaces the duplicate-name error (the submit button stays disabled).
  await page.getByPlaceholder('/path/to/folder').fill(folder)
  await expect(page.locator('.dialog__error')).toContainText('already exists')
  await expect(page.locator('.tmui-dialog__actions .tmui-button--primary')).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel' }).click()
}

async function addBranchOpensCreateDialog(): Promise<void> {
  const { page } = handle
  await newBranchButton().click()
  await expectCentredInWindow(page.getByRole('dialog', { name: 'Create Branch' }), 'Create Branch')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog', { name: 'Create Branch' })).toHaveCount(0)
}

async function createdBranchAppears(): Promise<void> {
  const { page } = handle
  await newBranchButton().click()
  await page.getByPlaceholder('My branch').fill(BRANCH)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(projectGroup(page, BRANCH)).toBeVisible()
}

async function branchShowsTabbedTerminals(): Promise<void> {
  const { page } = handle
  await projectGroup(page, BRANCH).click()
  await expect(page.locator('.tab-bar--sessions')).toBeVisible()
  // Selecting a branch opens its first terminal.
  await expect(sessionTabs()).toHaveCount(1)
}

async function plusOpensSessionTab(): Promise<void> {
  await handle.page.click('.tab-bar__new-tab')
  await expect(sessionTabs()).toHaveCount(2)
}

async function sessionTabsTrackActiveTab(): Promise<void> {
  await sessionTabs().first().click()
  await expect(sessionTabs().first()).toHaveClass(/tab-bar__tab--active/)
  await sessionTabs().nth(1).click()
  await expect(sessionTabs().nth(1)).toHaveClass(/tab-bar__tab--active/)
  await expect(sessionTabs().first()).not.toHaveClass(/tab-bar__tab--active/)
}

async function contextMenuOffersEditAndRemove(): Promise<void> {
  const { page } = handle
  await workspaceRow(page, WS).click({ button: 'right' })
  await expect(page.locator('.ctx-menu__item').filter({ hasText: 'Edit workspace' })).toBeVisible()
  await expect(
    page.locator('.ctx-menu__item').filter({ hasText: 'Remove workspace' })
  ).toBeVisible()
  // The context menu closes on any window click (no Escape handler).
  await clickSidebarSearch()
  await expect(page.locator('.ctx-menu')).toHaveCount(0)
}

async function renameShowsImmediately(): Promise<void> {
  const { page } = handle
  await workspaceRow(page, WS).click({ button: 'right' })
  await page.locator('.ctx-menu__item').filter({ hasText: 'Edit workspace' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Workspace' })
  await expectCentredInWindow(dialog, 'Edit Workspace')
  await dialog.locator('.dialog__input').first().fill(RENAMED)
  await page.click('.tmui-dialog__actions .tmui-button--primary')
  await expect(page.locator('.repo-header__name').filter({ hasText: RENAMED })).toBeVisible()
}

async function removeTakesWorkspaceAway(): Promise<void> {
  const { page } = handle
  await workspaceRow(page, RENAMED).click({ button: 'right' })
  await page.locator('.ctx-menu__item').filter({ hasText: 'Remove workspace' }).click()
  // The in-app ConfirmDialog, by role rather than class.
  const confirm = page.getByRole('dialog')
  await expect(confirm).toContainText('Remove workspace')
  await expectCentredInWindow(confirm, 'Confirm: Remove workspace')
  await confirm.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(page.locator('.repo-header__name').filter({ hasText: RENAMED })).toHaveCount(0)
  await expect(projectGroup(page, BRANCH)).toHaveCount(0)
}

async function theAppOpens(): Promise<void> {
  await test.step('the app renders the sidebar', sidebarRendersPromptly)
  await test.step('Home closes when the sidebar is clicked', homeClosesOnSidebarClick)
  await test.step('Overview closes when the sidebar is clicked', overviewClosesOnSidebarClick)
  await test.step('an extension closes when the sidebar is clicked', extensionClosesOnSidebarClick)
}

async function aWorkspaceIsCreated(): Promise<void> {
  await test.step(
    'New workspace opens a centred dialog with name, folder and colour fields',
    createDialogAsksNameFolderColour
  )
  await test.step(
    'Browse fills the workspace folder from the OS folder picker',
    browseFillsTheFolder
  )
  await test.step(
    'the created workspace appears in the sidebar with its name and colour band',
    workspaceAppearsWithColourBand
  )
  await test.step('a duplicate workspace name shows an inline error', duplicateNameShowsError)
}

async function itGetsABranchAndTabs(): Promise<void> {
  await test.step('Add Branch shows a centred Create Branch dialog', addBranchOpensCreateDialog)
  await test.step('a created branch appears under its workspace', createdBranchAppears)
  await test.step('clicking a branch shows its tabbed terminal view', branchShowsTabbedTerminals)
  await test.step('"+" in the tab bar opens a new terminal tab', plusOpensSessionTab)
  await test.step('several tabs track which one is active', sessionTabsTrackActiveTab)
}

async function itIsRenamedAndRemoved(): Promise<void> {
  await test.step(
    'right-clicking a workspace offers Edit and Remove',
    contextMenuOffersEditAndRemove
  )
  await test.step(
    'editing the name in a centred dialog updates the sidebar at once',
    renameShowsImmediately
  )
  await test.step(
    'removing the workspace after an in-app confirm takes it and its branch off the sidebar',
    removeTakesWorkspaceAway
  )
}

test('a workspace is created over a folder, given a branch and tabs, renamed and removed', async () => {
  await theAppOpens()
  await aWorkspaceIsCreated()
  await itGetsABranchAndTabs()
  await itIsRenamedAndRemoved()
})
