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

// How long to wait for a graceful Electron shutdown before force-killing. A
// healthy app closes in well under a second; this is only a guard against a
// hang. Kept well below Playwright's 30s hook timeout so a stuck close can
// never blow the afterAll hook (which cascades into a worker-teardown timeout
// and fails the whole job as a non-test error).
const GRACEFUL_CLOSE_MS = 5000

export async function closeApp(handle: AppHandle | undefined): Promise<void> {
  if (!handle) return
  // Capture the OS process up front: once app.close() resolves, Playwright
  // tears down its internal handle and app.process() would throw.
  const proc = handle.app.process()
  // Bound the graceful close: a lingering PTY, git watcher, or extension host
  // can keep the process alive so app.close() never resolves. Race it against a
  // timeout, then force-kill whatever is left. The .catch keeps a close() that
  // loses the race from surfacing as an unhandled rejection after the SIGKILL.
  const closed = handle.app.close().catch(() => {})
  await Promise.race([
    closed,
    new Promise<void>((resolve) => setTimeout(resolve, GRACEFUL_CLOSE_MS)),
  ])
  if (proc.exitCode === null && !proc.killed) {
    try {
      proc.kill('SIGKILL')
    } catch {
      // Process already exited between the check and the kill — nothing to do.
    }
  }
  // Retried, because the profile is still being written to as the app dies —
  // a terminal's scrollback, an extension's state, a transcript — and the
  // directory disappearing out from under those races the delete. Without this
  // a spec that ran a real agent fails in teardown as ENOTEMPTY, which reads
  // as a broken test rather than as tidying up too eagerly.
  if (handle.userDataDir) {
    // Two seconds of retries, not half of one: the supervision runtime keeps
    // its control-server settings, hook script and feed under userData, and on
    // a loaded CI machine those are still being flushed when the window goes.
    rmSync(handle.userDataDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  }
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
  await expect(workspaceRow(page, name)).toBeVisible()
}

/**
 * The workspace's row in the flat sidebar. The tree's `.ws-card` is gone —
 * grouping by project means a workspace has no card of its own, so its name,
 * colour band, tags and context menu live on this row instead.
 */
export function workspaceRow(page: Page, name: string) {
  return page.locator('.ws-row').filter({ has: page.locator('.ws-row__name', { hasText: name }) })
}

/**
 * A project's group header. Projects are groups now, and a project with no
 * sessions still gets a header so it can be selected and started in.
 */
export function projectGroup(page: Page, projectName: string) {
  return page
    .locator('.session-group')
    .filter({ has: page.locator('.session-group__label', { hasText: projectName }) })
}

/**
 * Add a plain (non-git) project to a workspace and click it. Selecting a project
 * is what sets the active workspace, which several panels (e.g. Workspace
 * Settings) require. Returns once the project group is present.
 */
export async function addAndSelectProject(
  page: Page,
  workspaceName: string,
  projectName: string
): Promise<void> {
  await workspaceRow(page, workspaceName).locator('.ws-row__add').click()
  await expect(page.locator('.dialog__title')).toContainText('Create Project')
  await page.getByPlaceholder('My Project').fill(projectName)
  await page.click('.dialog__btn-primary')
  const group = projectGroup(page, projectName)
  await expect(group).toBeVisible()
  // Clicking the header selects the project, exactly as clicking the tree's
  // project row did; the app's auto-open effect creates its first session.
  await group.locator('.session-group__header').click()
  await expect(group.locator('.session-row')).toHaveCount(1)
}

/** Re-select an existing project by activating its first session. */
export async function selectProject(
  page: Page,
  workspaceName: string,
  projectName: string
): Promise<void> {
  await projectGroup(page, projectName).locator('.session-group__header').click()
}
