import { _electron as electron, ElectronApplication, Page, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Shared e2e harness. Every spec launches the real Electron app in an isolated,
// throwaway profile (via Chromium's --user-data-dir, which Electron honours for
// app.getPath('userData')) so tests start from a clean store and never touch the
// developer's real Terminator data.

export interface AppHandle {
  app: ElectronApplication
  page: Page
  userDataDir: string
}

export async function launchApp(): Promise<AppHandle> {
  const userDataDir = mkdtempSync(join(tmpdir(), 'terminator-e2e-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('.unified-sidebar', { timeout: 15000 })
  return { app, page, userDataDir }
}

export async function closeApp(handle: AppHandle | undefined): Promise<void> {
  if (!handle) return
  await handle.app.close()
  if (handle.userDataDir) rmSync(handle.userDataDir, { recursive: true, force: true })
}

/**
 * Create a workspace via the sidebar dialog. `folderPath` is required by the
 * schema; pass a non-git directory (e.g. the test's userDataDir) to avoid the
 * auto-create-branch-project path.
 */
export async function createWorkspace(page: Page, name: string, folderPath: string): Promise<void> {
  await page.click('.sidebar-header__add')
  await page.waitForSelector('.dialog__title')
  await page.getByPlaceholder('My Workspace').fill(name)
  await page.getByPlaceholder('/path/to/folder').fill(folderPath)
  await page.click('.dialog__btn-primary')
  await expect(page.locator('.ws-card__name').filter({ hasText: name })).toBeVisible()
}

/** The `.ws-card` whose name matches `name`. */
export function workspaceCard(page: Page, name: string) {
  return page.locator('.ws-card').filter({ has: page.locator('.ws-card__name', { hasText: name }) })
}

/** Expand a workspace card if it is currently collapsed (new cards start collapsed). */
export async function expandWorkspace(page: Page, name: string): Promise<void> {
  const card = workspaceCard(page, name)
  if (
    !(await card
      .locator('.ws-card__add-project')
      .isVisible()
      .catch(() => false))
  ) {
    await card.locator('.ws-card__header').click()
    await expect(card.locator('.ws-card__add-project')).toBeVisible()
  }
}

/**
 * Add a plain (non-git) project to a workspace and click it. Selecting a project
 * is what sets the active workspace, which several panels (e.g. Workspace
 * Settings) require. Returns once the project row is active.
 */
export async function addAndSelectProject(
  page: Page,
  workspaceName: string,
  projectName: string
): Promise<void> {
  await expandWorkspace(page, workspaceName)
  const card = workspaceCard(page, workspaceName)
  await card.locator('.ws-card__add-project').click()
  await expect(page.locator('.dialog__title')).toContainText('Create Project')
  await page.getByPlaceholder('My Project').fill(projectName)
  await page.click('.dialog__btn-primary')
  const row = card.locator('.project-row').filter({ hasText: projectName })
  await expect(row).toBeVisible()
  await row.click()
}

/** Re-select an existing project (expanding its workspace first if needed). */
export async function selectProject(
  page: Page,
  workspaceName: string,
  projectName: string
): Promise<void> {
  await expandWorkspace(page, workspaceName)
  await workspaceCard(page, workspaceName)
    .locator('.project-row')
    .filter({ hasText: projectName })
    .click()
}
