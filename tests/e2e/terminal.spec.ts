import { test, expect } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  selectProject,
  workspaceCard,
} from './helpers'

// Sessions are created with default titles ("Terminal 1", "Terminal 2", …) — the
// old per-tab title/agent-type creation dialog no longer exists, and there is no
// UI path to create an "agent" session, so the agent-badge specs were dropped.
// Tabs are tracked by count and active state rather than custom titles.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

const sessionTabs = () => handle.page.locator('.tab-bar__tab--session')

test('US3-1: a project keeps its terminal sessions when switching workspaces', async () => {
  const { page, userDataDir } = handle
  // Workspace A with a project (selecting it auto-creates the first session).
  await createWorkspace(page, 'WS-Persist-A', userDataDir)
  await addAndSelectProject(page, 'WS-Persist-A', 'Proj-A')
  await page.keyboard.press('Meta+t') // second session
  await expect(sessionTabs()).toHaveCount(2)

  // Workspace B with its own project.
  await createWorkspace(page, 'WS-Persist-B', userDataDir)
  await addAndSelectProject(page, 'WS-Persist-B', 'Proj-B')
  await expect(sessionTabs()).toHaveCount(1)

  // Back to A — both sessions survived in the background.
  await selectProject(page, 'WS-Persist-A', 'Proj-A')
  await expect(sessionTabs()).toHaveCount(2)
})

test('US3-3: the terminal pane is visible when a project is active', async () => {
  const { page } = handle
  await selectProject(page, 'WS-Persist-A', 'Proj-A')
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
})

test('US3-5: Cmd+1 activates and expands the first workspace', async () => {
  const { page } = handle
  await page.keyboard.press('Meta+1')
  // Cmd+1 expands the first workspace and collapses the others.
  const firstCard = page.locator('.ws-card').first()
  await expect(firstCard.locator('.ws-card__projects')).toBeVisible()
})

test('US3-6: Cmd+ArrowRight cycles to the next session tab', async () => {
  const { page } = handle
  await selectProject(page, 'WS-Persist-A', 'Proj-A')
  await expect.poll(() => sessionTabs().count()).toBeGreaterThanOrEqual(2)

  await sessionTabs().first().click()
  await expect(sessionTabs().first()).toHaveClass(/tab-bar__tab--active/)
  await page.keyboard.press('Meta+ArrowRight')
  await expect(sessionTabs().first()).not.toHaveClass(/tab-bar__tab--active/)
})

test('US3-7: Cmd+T opens a new session tab', async () => {
  const { page } = handle
  await selectProject(page, 'WS-Persist-A', 'Proj-A')
  const before = await sessionTabs().count()
  await page.keyboard.press('Meta+t')
  await expect(sessionTabs()).toHaveCount(before + 1)
})

test('US4-1: closing a tab removes it from the session tab bar', async () => {
  const { page, userDataDir } = handle
  await createWorkspace(page, 'WS-Cleanup', userDataDir)
  await addAndSelectProject(page, 'WS-Cleanup', 'Proj-Cleanup')
  await page.keyboard.press('Meta+t')
  const before = await sessionTabs().count()
  await page.locator('.tab-bar__close').last().click()
  await expect(sessionTabs()).toHaveCount(before - 1)
})

test('US4-3: background sessions remain accessible after navigating away and back', async () => {
  const { page } = handle
  await selectProject(page, 'WS-Persist-B', 'Proj-B')
  await expect(sessionTabs()).toHaveCount(1)
  await selectProject(page, 'WS-Persist-A', 'Proj-A')
  await expect.poll(() => sessionTabs().count()).toBeGreaterThanOrEqual(2)
})

test('SC-002: switching session tabs keeps a terminal pane mounted', async () => {
  const { page } = handle
  await selectProject(page, 'WS-Persist-A', 'Proj-A')
  await expect.poll(() => sessionTabs().count()).toBeGreaterThanOrEqual(2)
  await sessionTabs().first().click()
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
  await sessionTabs().last().click()
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
})

test('SC-008: the UI stays responsive with several background sessions', async () => {
  const { page, userDataDir } = handle
  await createWorkspace(page, 'WS-Perf', userDataDir)
  await addAndSelectProject(page, 'WS-Perf', 'Proj-Perf')
  for (let i = 0; i < 4; i++) await page.keyboard.press('Meta+t')
  await expect.poll(() => sessionTabs().count()).toBeGreaterThanOrEqual(5)
  await sessionTabs().first().click()
  await sessionTabs().last().click()
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
  // The created workspace card still renders — UI not wedged.
  await expect(workspaceCard(page, 'WS-Perf')).toBeVisible()
})
