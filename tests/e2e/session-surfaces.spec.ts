import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

// A regression suite for feature 058: output arriving in a background terminal
// must never reorder Home or the wall, and every way of opening a session must
// focus its terminal. Addressed by role and name (contracts/ui-surfaces.md)
// wherever a role exists; a few rows have no clean accessible name (nested
// interactive children) and are addressed the way helpers.ts already does,
// by CSS class plus visible text.

let handle: AppHandle | undefined
let folder: string

test.beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'surfaces-'))
})

test.afterEach(async () => {
  await closeApp(handle)
  handle = undefined
  rmSync(folder, { recursive: true, force: true })
})

async function openHome(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Home/ })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Home' })).toBeVisible()
}

async function openOverview(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: /^Overview/ })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

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
  await page.locator('.terminal-pane').click()
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
}

/** Samples `read` every 250ms, `times` times, and returns the distinct results seen. */
async function sampleDistinct(read: () => Promise<string>, times: number): Promise<Set<string>> {
  const seen = new Set<string>()
  for (let i = 0; i < times; i++) {
    seen.add(await read())
    if (i < times - 1) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return seen
}

function sidebarTerminalRow(page: Page, title: string) {
  return page
    .locator('.terminal-row')
    .filter({ has: page.locator('.terminal-row__name', { hasText: title }) })
}

async function expectTerminalFocused(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null
        return el?.tagName === 'TEXTAREA' && el.getAttribute('aria-label') === 'Terminal input'
      })
    )
    .toBe(true)
}

test('output never reorders sessions, on Home or the wall', async () => {
  test.setTimeout(120_000)
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Order', folder)
  await addAndSelectProject(page, 'Order', 'loud')
  await addTwoMoreTabs(page)

  // Two of the three terminals never stop producing output.
  await runInTab(page, 0, 'while true; do echo tick; sleep 0.4; done')
  await runInTab(page, 1, 'while true; do echo tick; sleep 0.4; done')

  await openHome(page)
  const homeOrders = await sampleDistinct(
    () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[role="row"][aria-label]')]
          .map((el) => el.getAttribute('aria-label'))
          .join('|')
      ),
    40
  )
  expect(homeOrders.size).toBe(1)

  await openOverview(page)
  const wallOrders = await sampleDistinct(
    () =>
      page.evaluate(() =>
        [...document.querySelectorAll('.wall-tile')]
          .map((el) => getComputedStyle(el).order)
          .join('|')
      ),
    40
  )
  expect(wallOrders.size).toBe(1)
})

test('opening a session always focuses its terminal', async () => {
  test.setTimeout(60_000)
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Focus', folder)
  await addAndSelectProject(page, 'Focus', 'branch')
  await addTwoMoreTabs(page)
  // Default titles, in creation order: Terminal 1, Terminal 2, Terminal 3.

  // 1. Enter on a Ledger row.
  await openHome(page)
  const row = page.getByRole('row', { name: 'Terminal 1' })
  await row.locator('.ledger__name').click()
  await page.keyboard.press('Enter')
  await expectTerminalFocused(page)
  await expect(page.getByRole('heading', { name: 'Home' })).toBeHidden()

  // 2. The "Open <name>" button on a wall tile.
  await openOverview(page)
  await page
    .getByRole('article', { name: /Terminal 2/ })
    .getByRole('button', { name: 'Open Terminal 2' })
    .click()
  await expectTerminalFocused(page)

  // 3. A sidebar terminal row, for a different session.
  await page.locator('.branch-row__disclosure[aria-label^="Show terminals in"]').click()
  await sidebarTerminalRow(page, 'Terminal 3').click()
  await expectTerminalFocused(page)

  // 4. The sidebar row of the already-active session, clicked again.
  await sidebarTerminalRow(page, 'Terminal 3').click()
  await expectTerminalFocused(page)

  // 5. A session tab in the tab bar.
  await page.locator('.tab-bar__tab--session').nth(0).click()
  await expectTerminalFocused(page)

  // 6. Quick Actions, opened over Home.
  await openHome(page)
  await page.keyboard.press('Meta+p')
  await page.keyboard.press('/')
  const search = page.getByRole('combobox', { name: 'Search quick actions' })
  await expect(search).toBeVisible()
  await search.fill('Terminal 2')
  await page.keyboard.press('Enter')
  await expectTerminalFocused(page)
  await expect(page.getByRole('heading', { name: 'Home' })).toBeHidden()
})

test('a session link made from Home shows on the sidebar terminal row and the session tab', async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Linked', folder)
  await addAndSelectProject(page, 'Linked', 'ticket')
  // 'Terminal 1' is the branch's only session.

  // Give the session a real record (a description write), so the main
  // process has assigned it a snapshot we can read back the exact fields of —
  // no tracker is connected in e2e, so the link itself is set through the
  // preload API directly, as src/renderer/stores/session-records.store.ts does.
  await openHome(page)
  const box = page
    .getByRole('row', { name: 'Terminal 1' })
    .getByRole('textbox', { name: 'What is this session doing?' })
  await box.fill('Wiring up the link')
  await box.press('Enter')
  await expect(page.getByText('Wiring up the link')).toBeVisible()

  await page.evaluate(async () => {
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
  })

  // Branches start collapsed, so the branch row itself must carry the key.
  await expect(page.getByRole('button', { name: /^ticket/ }).getByText('ENG-123')).toBeVisible()

  await page.locator('.branch-row__disclosure[aria-label^="Show terminals in"]').click()
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
})
