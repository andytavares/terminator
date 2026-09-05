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

const branchRow = () => handle.page.locator('.branch-row').first()

test('the branch row names its branch and marks it as a plain checkout', async () => {
  // The kind glyph marks the exception. A worktree is the norm here, so it is
  // left unmarked and only a plain checkout carries a glyph.
  const glyph = branchRow().locator('.branch-row__kind svg')
  await expect(glyph).toBeVisible()
  await expect(glyph).toHaveAttribute('data-kind', 'branch')
  await expect(branchRow().locator('.branch-row__name')).toHaveText('main')
  // The word is gone: one element says which kind, not a glyph and a chip.
  await expect(handle.page.locator('.unified-sidebar')).not.toContainText('worktree')
})

test('the repo header offers its folder path without drawing it', async () => {
  const header = handle.page.locator('.repo-header').first()
  // On the name, not the row: a native tooltip covers whatever is beneath it,
  // and a full-width trigger blanketed the branches below.
  await expect(header.locator('.repo-header__name')).toHaveAttribute('title', /.+/)
  await expect(header).not.toHaveAttribute('title', /.+/)
  await expect(header).not.toContainText('/')
})

test('the folder path is abbreviated to the home directory', async () => {
  const title = await handle.page.locator('.repo-header__name').first().getAttribute('title')
  expect(title).not.toBeNull()
  // A full absolute path made the tooltip wide enough to cover several rows.
  expect(title!.startsWith('~/') || !title!.startsWith('/Users/')).toBe(true)
})

test('the repo header draws no more than three things at rest', async () => {
  const drawn = await handle.page.evaluate(() => {
    const h = document.querySelector('.repo-header')
    if (h === null) return -1
    return [...h.children].filter(
      (c) =>
        !c.classList.contains('repo-header__hover') && !c.classList.contains('repo-header__swatch')
    ).length
  })
  expect(drawn).toBeGreaterThan(0)
  expect(drawn).toBeLessThanOrEqual(3)
})

test('no terminal is listed in the sidebar', async () => {
  await branchRow().click()
  await handle.page.waitForSelector('.tab-bar__tab--session', { timeout: 15000 })
  // The terminal exists; it is simply not a sidebar row any more.
  await expect(handle.page.locator('.unified-sidebar .session-row')).toHaveCount(0)
})

test('change statistics arrive without blocking the list', async () => {
  // The list is already painted by the time we look; the statistics fill in.
  await expect(handle.page.locator('.branch-row__stats').first()).toBeVisible({
    timeout: 10000,
  })
  await expect(handle.page.locator('.branch-row__stats').first()).toContainText('+')
})

test('a branch shows its state as a glyph, and selection as the row', async () => {
  await branchRow().click()
  await expect(branchRow()).toHaveClass(/branch-row--selected/)
  // The glyph reports state, and it is not the thing marking selection.
  await expect(branchRow().locator('.branch-row__gutter svg')).toHaveAttribute('data-state', /.+/)
})

test('each terminal carries its own state on its tab', async () => {
  await branchRow().click()
  await handle.page.waitForSelector('.tab-bar__tab--session', { timeout: 15000 })
  await expect(handle.page.locator('.tab-bar__state svg').first()).toHaveAttribute(
    'data-state',
    /.+/
  )
})

test('the session tab bar states which branch it is showing', async () => {
  await expect(handle.page.locator('.tab-bar__scope')).toContainText('main')
})

test('app-level surfaces sit in one band, each with an accessible name', async () => {
  const band = handle.page.locator('.app-band')
  await expect(band).toBeVisible()
  await expect(band.locator('.app-band__entry').first()).toHaveAttribute('aria-label', /.+/)
})

test('the old split surfaces are gone', async () => {
  await expect(handle.page.locator('.extension-footer')).toHaveCount(0)
  await expect(handle.page.locator('.scratch-section')).toHaveCount(0)
  await expect(handle.page.locator('.sidebar-header__tabs')).toHaveCount(0)
  // Removed by the cut: terminal rows, the always-visible new-branch strip,
  // and the bulk-close bar that operated on their checkboxes.
  await expect(handle.page.locator('.ws-row')).toHaveCount(0)
  await expect(handle.page.locator('.unified-sidebar__bulk-bar')).toHaveCount(0)
})

test('the sidebar says branch, never project', async () => {
  const text = (await handle.page.locator('.unified-sidebar').textContent()) ?? ''
  expect(text.toLowerCase()).not.toContain('project')
  // Creating a branch moved from an always-visible strip to the repo header's
  // hover control, so the words are its accessible name rather than drawn text.
  const labels = await handle.page
    .locator('.repo-header__action')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))
  expect(labels.some((l) => l.startsWith('New branch in'))).toBe(true)
})

test('at most two bands of chrome sit above the first row of work (FR-033, SC-002)', async () => {
  const measured = await handle.page.evaluate(() => {
    const sidebar = document.querySelector('.unified-sidebar')
    const firstRow = document.querySelector('.repo-header')
    if (sidebar === null || firstRow === null) return null
    const bands = document.querySelectorAll(
      '.unified-sidebar > .sidebar-header > *, .unified-sidebar > .view-bar, .unified-sidebar > .filter-notice'
    ).length
    return {
      bands,
      chrome: Math.round(
        firstRow.getBoundingClientRect().top - sidebar.getBoundingClientRect().top
      ),
    }
  })
  expect(measured).not.toBeNull()
  // Was four bands and 165px on the build this replaces; SC-002 asks for a 40%
  // cut, which is 99px.
  expect(measured!.bands).toBeLessThanOrEqual(2)
  expect(measured!.chrome).toBeLessThanOrEqual(99)
})

test('the retired chrome is gone entirely', async () => {
  await expect(handle.page.locator('.view-bar')).toHaveCount(0)
  await expect(handle.page.locator('.filter-notice')).toHaveCount(0)
})

test('every view, grouping and sort control lives in two menus (FR-034)', async () => {
  const filter = handle.page.getByRole('button', { name: /^Filter/ })
  const display = handle.page.getByRole('button', { name: 'Display' })
  await expect(filter).toBeVisible()
  await expect(display).toBeVisible()

  await display.click()
  for (const name of ['Workspace', 'None', 'Recent', 'Name']) {
    await expect(handle.page.getByRole('menuitemradio', { name })).toBeVisible()
  }
  await handle.page.keyboard.press('Escape')
  await handle.page.locator('.unified-sidebar__list').click({ position: { x: 5, y: 5 } })

  await filter.click()
  for (const name of [/Everything/, /Needs me/, /Active/, /Stale/]) {
    await expect(handle.page.getByRole('menuitemradio', { name })).toBeVisible()
  }
  await expect(handle.page.getByRole('menuitemcheckbox', { name: /Hide stale/ })).toBeVisible()
})
