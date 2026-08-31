import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace, workspaceRow } from './helpers'

/**
 * A branch card is named by its branch (ADR-034), and the branch is the one its
 * working tree is on — not a label chosen when the card was made, and not a
 * snapshot of the branch it was made on.
 *
 * This is the one e2e workspace pointed at a real repository. The rest use a
 * non-git directory on purpose; the naming rule only exists where there is a
 * branch, so it cannot be tested there.
 */
let handle: AppHandle
let repo: string
const WS = 'Branch Name Workspace'

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
}

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'terminator-e2e-repo-'))
  git('init', '--initial-branch=main')
  git('config', 'user.email', 'e2e@example.com')
  git('config', 'user.name', 'E2E')
  git('commit', '--allow-empty', '-m', 'root')

  handle = await launchApp()
  await createWorkspace(handle.page, WS, repo)
})

test.afterAll(async () => {
  await closeApp(handle)
})

test('a workspace over a repo names its first card after the checked-out branch', async () => {
  const { page } = handle
  await expect(page.locator('.session-group__label', { hasText: /^main$/ }).first()).toBeVisible()
})

test('the create dialog asks for a branch and no other name', async () => {
  const { page } = handle
  await workspaceRow(page, WS).locator('.ws-row__add').click()
  await expect(page.locator('.dialog__title')).toContainText('Create Branch')
  // The Name field only exists where there is no branch to take a name from.
  await expect(page.getByPlaceholder('My branch')).toHaveCount(0)
  // The branch is the only thing it asks for, so submitting without one is
  // refused for the branch rather than for a missing name.
  await page.click('.dialog__btn-primary')
  await expect(page.locator('.dialog__error')).toContainText('Select or enter a branch name')
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.locator('.dialog__title')).toHaveCount(0)
})

test('the card follows a checkout made outside the app', async () => {
  const { page } = handle
  git('checkout', '-b', 'feature/renamed-by-git')
  // Polled, so allow more than one interval before calling it a failure.
  await expect(
    page.locator('.session-group__label', { hasText: 'feature/renamed-by-git' }).first()
  ).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.session-group__label', { hasText: /^main$/ })).toHaveCount(0)
})

test('a branch offers no rename, because there is nothing else to name', async () => {
  const { page } = handle
  await page
    .locator('.session-group__header')
    .filter({ hasText: 'feature/renamed-by-git' })
    .last()
    .click({ button: 'right' })
  await expect(page.locator('.ctx-menu__item').filter({ hasText: 'Rename' })).toHaveCount(0)
  await page.keyboard.press('Escape')
})
