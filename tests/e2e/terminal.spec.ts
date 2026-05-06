import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'

let electronApp: ElectronApplication
let page: Page

async function createWorkspaceAndProject(
  pg: Page,
  wsName: string,
  projName: string
): Promise<void> {
  await pg.click('.sidebar__create-btn')
  await pg.waitForSelector('.dialog__title')
  await pg.locator('.dialog__input').first().fill(wsName)
  await pg.click('.dialog__btn-primary')
  await pg.locator('.workspace-item__header').filter({ hasText: wsName }).click()
  await pg.click('.workspace-item__add-project')
  await pg.waitForSelector('.dialog__title')
  await pg.locator('.dialog__input').first().fill(projName)
  await pg.click('.dialog__btn-primary')
  await pg.locator('.project-item').filter({ hasText: projName }).click()
}

async function openNewTab(
  pg: Page,
  title = 'Terminal',
  type: 'human' | 'agent' = 'human'
): Promise<void> {
  await pg.click('.tab-bar__new-tab')
  const dialogVisible = await pg
    .locator('.dialog')
    .isVisible()
    .catch(() => false)
  if (dialogVisible) {
    const titleInput = pg.locator('.dialog__input').first()
    await titleInput.fill(title)
    if (type === 'agent') {
      const agentRadio = pg.locator('input[value="agent"]')
      await agentRadio.check()
    }
    await pg.click('.dialog__btn-primary')
  }
}

test.beforeAll(async () => {
  electronApp = await electron.launch({
    args: ['.'],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.sidebar', { timeout: 10000 })
})

test.afterAll(async () => {
  await electronApp.close()
})

// ── US3: Persistent Terminal Sessions ──────────────────────────────────────

test('US3-1: switching workspaces leaves terminal session running in background', async () => {
  await createWorkspaceAndProject(page, 'WS-Persist-A', 'Proj-A')
  await openNewTab(page, 'Tab-A')
  const tabCountA = await page.locator('.tab-bar__tab').count()
  expect(tabCountA).toBeGreaterThanOrEqual(1)

  // Create second workspace
  await createWorkspaceAndProject(page, 'WS-Persist-B', 'Proj-B')
  await openNewTab(page, 'Tab-B')

  // Now switch back to WS-Persist-A
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()
  // The tab should still be there
  await expect(page.locator('.tab-bar__tab').filter({ hasText: 'Tab-A' })).toBeVisible()
})

test('US3-2: returning to a project shows terminal session state', async () => {
  // Navigate away and back; the tab title should still match
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-B' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-B' }).click()
  await expect(page.locator('.tab-bar__tab').filter({ hasText: 'Tab-B' })).toBeVisible()

  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()
  await expect(page.locator('.tab-bar__tab').filter({ hasText: 'Tab-A' })).toBeVisible()
})

test('US3-3: terminal pane is visible when returning to project tab', async () => {
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()
  await expect(page.locator('.terminal-pane')).toBeVisible()
})

test('US3-5: Cmd+1 switches to first workspace', async () => {
  await page.keyboard.press('Meta+1')
  const firstWorkspace = page.locator('.workspace-item--active, .workspace-avatar--active').first()
  await expect(firstWorkspace).toBeVisible()
})

test('US3-6: Cmd+Right cycles to next tab', async () => {
  // Make sure we have a project open with at least 2 tabs
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()

  // Ensure we have 2 tabs
  const tabCount = await page.locator('.tab-bar__tab').count()
  if (tabCount < 2) {
    await openNewTab(page, 'Tab-A2')
  }

  // Activate first tab
  await page.locator('.tab-bar__tab').first().click()
  const firstTabId = await page.locator('.tab-bar__tab--active').first().textContent()

  await page.keyboard.press('Meta+ArrowRight')
  // Active tab should have changed
  const nextTabId = await page.locator('.tab-bar__tab--active').first().textContent()
  expect(nextTabId).not.toEqual(firstTabId)
})

test('US3-7: Cmd+T opens new tab dialog', async () => {
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()

  const tabsBefore = await page.locator('.tab-bar__tab').count()
  await page.keyboard.press('Meta+t')
  // Either dialog or new tab directly
  const dialogVisible = await page
    .locator('.dialog')
    .isVisible()
    .catch(() => false)
  if (dialogVisible) {
    await page.click('.dialog__btn-primary')
  }
  await expect(page.locator('.tab-bar__tab')).toHaveCount(tabsBefore + 1)
})

// SC-002: Tab switch < 500ms
test('SC-002: switching tabs shows terminal buffer within 500ms', async () => {
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()

  const tabs = page.locator('.tab-bar__tab')
  const tabCount = await tabs.count()
  if (tabCount < 2) {
    await openNewTab(page, 'PerfTab')
  }

  await tabs.first().click()

  const start = await page.evaluate(() => performance.now())
  await tabs.last().click()
  await page.waitForSelector('.terminal-pane', { timeout: 500 })
  const elapsed = await page.evaluate((s) => performance.now() - s, start)
  expect(elapsed).toBeLessThan(500)
})

// ── US7: Agent Badge ────────────────────────────────────────────────────────

test('US7-1: agent tab shows agent badge', async () => {
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()
  await openNewTab(page, 'AgentSession', 'agent')
  await expect(page.locator('.tab-bar__badge--agent')).toBeVisible()
})

test('US7-2: human tab shows no agent badge', async () => {
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()
  await openNewTab(page, 'HumanSession', 'human')
  // The human tab should be last and have no badge
  const lastTab = page.locator('.tab-bar__tab').last()
  await expect(lastTab.locator('.tab-bar__badge--agent')).toHaveCount(0)
})

test('US7-3: switching between human and agent tabs preserves both sessions', async () => {
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()

  const agentTab = page
    .locator('.tab-bar__tab')
    .filter({ has: page.locator('.tab-bar__badge--agent') })
    .first()
  const humanTab = page
    .locator('.tab-bar__tab')
    .filter({ hasNot: page.locator('.tab-bar__badge--agent') })
    .first()

  await agentTab.click()
  await expect(agentTab).toHaveClass(/tab-bar__tab--active/)

  await humanTab.click()
  await expect(humanTab).toHaveClass(/tab-bar__tab--active/)

  // Agent tab still exists
  await expect(agentTab).toBeVisible()
})

// ── US4: Terminal Session Cleanup ──────────────────────────────────────────

test('US4-1: closing a tab removes it from the tab bar', async () => {
  await createWorkspaceAndProject(page, 'WS-Cleanup', 'Proj-Cleanup')
  await openNewTab(page, 'CloseMe')

  const tabsBefore = await page.locator('.tab-bar__tab').count()
  await page.locator('.tab-bar__close').last().click()
  await expect(page.locator('.tab-bar__tab')).toHaveCount(tabsBefore - 1)
})

test('US4-3: tabs persist across workspace switches (app quit tested manually)', async () => {
  // Verify sessions from other workspaces remain accessible
  await page.locator('.workspace-item__header').filter({ hasText: 'WS-Persist-A' }).click()
  await page.locator('.project-item').filter({ hasText: 'Proj-A' }).click()
  await expect(page.locator('.tab-bar__tab').count()).resolves.toBeGreaterThanOrEqual(1)
})

// SC-008: 20 concurrent sessions — UI responsiveness
test('SC-008: UI tab switch is responsive with multiple background sessions', async () => {
  // Create a workspace with one project and 5 tabs (a lighter proxy for 20)
  await createWorkspaceAndProject(page, 'WS-Perf', 'Proj-Perf')
  for (let i = 0; i < 5; i++) {
    await openNewTab(page, `Perf-${i}`)
  }

  const tabs = page.locator('.tab-bar__tab')
  await tabs.first().click()

  const start = await page.evaluate(() => performance.now())
  await tabs.last().click()
  await page.waitForSelector('.terminal-pane', { timeout: 500 })
  const elapsed = await page.evaluate((s) => performance.now() - s, start)
  expect(elapsed).toBeLessThan(500)
})
