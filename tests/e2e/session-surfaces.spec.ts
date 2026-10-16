import { test, expect, type Page } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
} from './helpers'
import {
  expectTerminalFocused,
  openHome,
  openOverview,
  runInVisibleTerminal,
} from './session-views'

// Feature 058: background output never reorders Home or the wall, and opening a session focuses
// its terminal. Rows with nested interactive children have no clean accessible name, so they
// are addressed as helpers.ts does, by CSS class plus visible text.

/** Starts a second and third terminal on the branch already showing. */
async function addTwoMoreTabs(page: Page): Promise<void> {
  const newTab = page.getByTitle('New tab (⌘T)')
  await newTab.click()
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(2)
  await newTab.click()
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(3)
}

/** Runs a command in the terminal whose tab is at `index`, without waiting for it to finish. */
async function runInTab(page: Page, index: number, command: string): Promise<void> {
  await page.locator('.tab-bar__tab--session').nth(index).click()
  await runInVisibleTerminal(page, command)
}

/** Samples `read` every 250ms, `times` times, and returns the distinct results seen. */
async function sampleDistinct(read: () => Promise<string>, times: number): Promise<Set<string>> {
  const seen = new Set<string>()
  for (let i = 0; i < times; i++) {
    seen.add(await read())
    // Stability over time is what is asserted, so the interval is the point.
    // eslint-disable-next-line no-restricted-syntax
    if (i < times - 1) await new Promise((done) => setTimeout(done, 250))
  }
  return seen
}

function sidebarTerminalRow(page: Page, title: string) {
  return page
    .locator('.terminal-row')
    .filter({ has: page.locator('.terminal-row__name', { hasText: title }) })
}

/** Shows the branch's terminals in the sidebar, unless they already are. */
async function showSidebarTerminals(page: Page): Promise<void> {
  const show = page.locator('.branch-row__disclosure[aria-label^="Show terminals in"]')
  if ((await show.count()) > 0) await show.click()
  await expect(page.locator('.terminal-row').first()).toBeVisible()
}

/** The Ledger's rows, top to bottom. */
function ledgerOrder(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[role="row"][aria-label]')]
      .map((el) => el.getAttribute('aria-label'))
      .join('|')
  )
}

/** The wall's tiles, by the order each is drawn in. */
function wallOrder(page: Page): Promise<string> {
  return page.evaluate(() =>
    [...document.querySelectorAll('.wall-tile')].map((el) => getComputedStyle(el).order).join('|')
  )
}

async function outputNeverReorders(page: Page): Promise<void> {
  // Two of the three terminals never stop producing output.
  await runInTab(page, 0, 'while true; do echo tick; sleep 0.4; done')
  await runInTab(page, 1, 'while true; do echo tick; sleep 0.4; done')
  await openHome(page)
  expect((await sampleDistinct(() => ledgerOrder(page), 40)).size).toBe(1)
  await openOverview(page)
  expect((await sampleDistinct(() => wallOrder(page), 40)).size).toBe(1)
}

/** Run in the page: links Terminal 1's record to ENG-123 through the preload API. */
async function linkTerminalOneToEng123(): Promise<void> {
  const { data } = await window.electronAPI.sessionRecords.list()
  const record = data.find((r) => r.tabTitle === 'Terminal 1')
  if (!record) throw new Error('no record for Terminal 1')
  const { sessionId, projectId, workspaceName, projectName, branch, tabTitle, shell, startedAt } =
    record
  const session = {
    sessionId,
    projectId,
    workspaceName,
    projectName,
    branch,
    tabTitle,
    shell,
    startedAt,
  }
  const result = await window.electronAPI.sessionRecords.setLink({
    session,
    link: { tracker: 'linear', key: 'ENG-123' },
  })
  if ('error' in result) throw new Error(result.message)
}

/** Gives Terminal 1 a real record (a description write) and links it. No tracker is connected in
 * e2e, so the link is set through the preload API, as src/renderer/stores/session-records.store.ts does. */
async function linkFromHome(page: Page): Promise<void> {
  await openHome(page)
  const box = page
    .getByRole('row', { name: 'Terminal 1' })
    .getByRole('textbox', { name: 'What is this session doing?' })
  await box.fill('Wiring up the link')
  await box.press('Enter')
  await expect(page.getByText('Wiring up the link')).toBeVisible()
  await page.evaluate(linkTerminalOneToEng123)
}

async function linkShowsOnSidebarAndTab(page: Page): Promise<void> {
  await linkFromHome(page)
  // Branches start collapsed, so the branch row itself must carry the key.
  await expect(page.getByRole('button', { name: /^ticket/ }).getByText('ENG-123')).toBeVisible()
  await showSidebarTerminals(page)
  const row = sidebarTerminalRow(page, 'Terminal 1')
  await expect(row.getByText('ENG-123')).toBeVisible()
  // Leave Home to see the tab bar's own copy of the key.
  await row.click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeHidden()
  await expect(page.locator('.tab-bar__tab--session').getByText('ENG-123')).toBeVisible()
  await row.click({ button: 'right' })
  await page.locator('.ctx-menu').getByRole('button', { name: 'Remove session link' }).click()
  await expect(row.getByText('ENG-123')).toHaveCount(0)
  await expect(page.locator('.tab-bar__tab--session').getByText('ENG-123')).toHaveCount(0)
}

/** 1. Enter on a Ledger row. 2. The "Open <name>" button on a wall tile. */
async function openFromHomeAndWall(page: Page): Promise<void> {
  await openHome(page)
  await page.getByRole('row', { name: 'Terminal 1' }).locator('.ledger__name').click()
  await page.keyboard.press('Enter')
  await expectTerminalFocused(page)
  await expect(page.getByRole('heading', { name: 'Home' })).toBeHidden()
  await openOverview(page)
  await page
    .getByRole('article', { name: /Terminal 2/ })
    .getByRole('button', { name: 'Open Terminal 2' })
    .click()
  await expectTerminalFocused(page)
}

/** 3. A sidebar terminal row, for a different session. 4. The sidebar row of
 * the already-active session, clicked again. 5. A session tab in the tab bar. */
async function openFromSidebarAndTabs(page: Page): Promise<void> {
  await showSidebarTerminals(page)
  await sidebarTerminalRow(page, 'Terminal 3').click()
  await expectTerminalFocused(page)
  await sidebarTerminalRow(page, 'Terminal 3').click()
  await expectTerminalFocused(page)
  await page.locator('.tab-bar__tab--session').nth(0).click()
  await expectTerminalFocused(page)
}

/** 6. Quick Actions, opened over Home. */
async function openFromQuickActions(page: Page): Promise<void> {
  await openHome(page)
  await page.keyboard.press('Meta+p')
  await page.keyboard.press('/')
  const search = page.getByRole('combobox', { name: 'Search quick actions' })
  await expect(search).toBeVisible()
  await search.fill('Terminal 2')
  await page.keyboard.press('Enter')
  await expectTerminalFocused(page)
  await expect(page.getByRole('heading', { name: 'Home' })).toBeHidden()
}

async function openingFocusesTheTerminal(page: Page): Promise<void> {
  await openFromHomeAndWall(page)
  await openFromSidebarAndTabs(page)
  await openFromQuickActions(page)
}

test.describe('session surfaces', () => {
  let handle: AppHandle

  test.beforeAll(async () => {
    handle = await launchApp()
  })

  test.afterAll(() => closeApp(handle))

  test('three sessions are watched, linked and opened from every surface that names them', async () => {
    test.setTimeout(120_000)
    const { page } = handle
    await createWorkspace(page, 'Surfaces', e2eTempDir('surfaces-'))
    await addAndSelectProject(page, 'Surfaces', 'ticket')
    // Default titles, in creation order: Terminal 1, Terminal 2, Terminal 3.
    await addTwoMoreTabs(page)
    await test.step('output never reorders sessions, on Home or the wall', () =>
      outputNeverReorders(page))
    await test.step('a session link made from Home shows on the sidebar terminal row and the session tab', () =>
      linkShowsOnSidebarAndTab(page))
    await test.step('opening a session always focuses its terminal', () =>
      openingFocusesTheTerminal(page))
  })
})
