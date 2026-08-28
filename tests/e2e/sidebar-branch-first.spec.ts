import { test, expect } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppHandle, launchApp, closeApp, createWorkspace } from './helpers'

// End-to-end cover for the branch-first sidebar. Everything here is asserted
// against the real app with a real git repository, because every defect this
// feature fixed was invisible to the unit tests that were passing at the time.

let handle: AppHandle
let repo: string

test.beforeAll(async () => {
  repo = mkdtempSync(join(tmpdir(), 'branch-first-'))
  const run = (c: string): void => {
    execSync(c, { cwd: repo, stdio: 'ignore' })
  }
  run('git init -b main')
  run('git config user.email "test@test.com"')
  run('git config user.name "Test"')
  writeFileSync(join(repo, 'README.md'), '# Test\n'.repeat(20))
  run('git add -A')
  run('git commit -m "initial"')
  // Uncommitted work, so the branch row has statistics to show.
  writeFileSync(join(repo, 'README.md'), '# Changed\n'.repeat(30))
  run('git add README.md')

  handle = await launchApp()
  await createWorkspace(handle.page, 'Repo One', repo)
})

test.afterAll(async () => {
  await closeApp(handle)
  if (repo) rmSync(repo, { recursive: true, force: true })
})

const branchRow = () =>
  handle.page.locator('.session-group:not(:has(.session-group)) .session-group__header').first()

test('the branch row names its branch and marks it as a plain checkout', async () => {
  const glyph = branchRow().locator('.session-group__branch-glyph')
  await expect(glyph).toBeVisible()
  await expect(glyph).toHaveAttribute('data-kind', 'branch')
  await expect(branchRow().locator('.session-group__label')).toHaveText('main')
  await expect(branchRow().locator('.session-group__worktree-tag')).toHaveCount(0)
})

test('the repo header carries its folder path', async () => {
  await expect(handle.page.locator('.session-group__repo-path').first()).toBeVisible()
})

test('change statistics arrive without blocking the list', async () => {
  // The list is already painted by the time we look; the statistics fill in.
  await expect(handle.page.locator('.session-group__stats').first()).toBeVisible({
    timeout: 10000,
  })
  await expect(handle.page.locator('.session-group__stats').first()).toContainText('+')
})

test('a session shows its state as a glyph, and selection as the row', async () => {
  await branchRow().click()
  const row = handle.page.locator('.session-row').first()
  await expect(row).toHaveClass(/session-row--active/)
  // The glyph reports state, and it is not the thing marking selection.
  await expect(row.locator('.session-row__status svg')).toHaveAttribute('data-state', /.+/)
})

test('the session tab bar states which branch it is showing', async () => {
  await expect(handle.page.locator('.tab-bar__scope')).toContainText('main')
})

test('app-level surfaces sit in one labelled band', async () => {
  const band = handle.page.locator('.app-band')
  await expect(band).toBeVisible()
  await expect(band.locator('.app-band__entry').first()).toHaveAttribute('aria-label', /.+/)
  // Every entry shows visible text, not just an icon.
  const labels = await band.locator('.app-band__label').allTextContents()
  expect(labels.length).toBeGreaterThan(0)
  expect(labels.every((l) => l.trim().length > 0)).toBe(true)
})

test('the old split surfaces are gone', async () => {
  await expect(handle.page.locator('.extension-footer')).toHaveCount(0)
  await expect(handle.page.locator('.scratch-section')).toHaveCount(0)
  await expect(handle.page.locator('.sidebar-header__tabs')).toHaveCount(0)
})

test('the sidebar says branch, never project', async () => {
  const text = (await handle.page.locator('.unified-sidebar').textContent()) ?? ''
  expect(text.toLowerCase()).not.toContain('project')
  expect(text).toContain('New branch in')
})
