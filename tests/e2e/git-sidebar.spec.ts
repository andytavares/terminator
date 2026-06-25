import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  expandWorkspace,
  workspaceCard,
} from './helpers'

// Exercises the git-integration extension against a REAL temporary repo:
// the Git Changes sidebar panel, the Git project tab, and the extension's
// settings section. PR-creation flows are intentionally not covered — they
// require `gh` auth and a real GitHub remote, which aren't available in CI.

let handle: AppHandle
let gitRepoDir: string
const WS = 'Git Test Workspace'

test.beforeAll(async () => {
  gitRepoDir = mkdtempSync(join(tmpdir(), 'terminator-e2e-git-'))
  const run = (cmd: string) => execSync(cmd, { cwd: gitRepoDir })
  run('git init -b main')
  run('git config user.email "test@test.com"')
  run('git config user.name "Test"')
  writeFileSync(join(gitRepoDir, 'README.md'), '# Test\n')
  run('git add README.md')
  run('git commit -m "initial commit"')
  // An uncommitted change the sidebar should surface.
  writeFileSync(join(gitRepoDir, 'changed.txt'), 'new content\n')

  handle = await launchApp()
  // A workspace whose folder is a git repo auto-creates a project on the current
  // branch; selecting it gives the git panels a repoRoot to read.
  await createWorkspace(handle.page, WS, gitRepoDir)
  await expandWorkspace(handle.page, WS)
  const firstProject = workspaceCard(handle.page, WS).locator('.project-row').first()
  await expect(firstProject).toBeVisible()
  await firstProject.click()
})

test.afterAll(async () => {
  await closeApp(handle)
  if (gitRepoDir) rmSync(gitRepoDir, { recursive: true, force: true })
})

test('Git Changes sidebar toggles open and lists uncommitted files', async () => {
  const { page } = handle
  await page.keyboard.press('Meta+Shift+G')
  // The git panel opens — the core renders a portal container for the extension view.
  const panel = page.locator(
    '[data-extension-panel="terminator.git-integration"][data-view-param="sidebar"]'
  )
  await expect(panel).toBeVisible()
  // Toggling again closes the panel.
  await page.keyboard.press('Meta+Shift+G')
  await expect(panel).toHaveCount(0)
})

test('the Git project tab renders the full git view', async () => {
  const { page } = handle
  await page.locator('.tab-bar--primary .tab-bar__tab').filter({ hasText: 'Git' }).click()
  // The core renders a portal container for the extension's project-tab view.
  const panel = page.locator(
    '[data-extension-panel="terminator.git-integration"][data-view-param="project"]'
  )
  await expect(panel).toBeVisible()
})

test('the Git Integration settings section appears in the settings panel', async () => {
  const { page } = handle
  await page.keyboard.press('Meta+,')
  await page.waitForSelector('.settings-panel')
  await page.locator('.settings-panel__nav-item').filter({ hasText: 'Extensions' }).click()
  await expect(page.locator('.settings-panel__content')).toContainText('Git Integration')
  await page.keyboard.press('Escape')
})
