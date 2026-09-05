import { test, expect } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, closeApp, createWorkspace, addAndSelectProject, AppHandle } from './helpers'

// A branch whose folder has gone — a worktree removed outside the app, a repo
// deleted — used to get a terminal all the same: node-pty forked, could not
// chdir, and the child exited 1 having printed nothing, so the operator saw a
// tab appear and die with a blank screen and no reason given.

let handle: AppHandle | undefined
let folder: string | undefined

test.afterAll(async () => {
  await closeApp(handle)
  if (folder) rmSync(folder, { recursive: true, force: true })
})

test('a branch whose folder is gone says so instead of opening a dead terminal', async () => {
  folder = mkdtempSync(join(tmpdir(), 'terminator-gone-'))
  handle = await launchApp()
  const { page } = handle

  await createWorkspace(page, 'Gone', folder)
  await addAndSelectProject(page, 'Gone', 'branch-a')
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1)

  // The folder disappears under the app, exactly as `git worktree remove` or a
  // `rm -rf` outside it would.
  rmSync(folder, { recursive: true, force: true })

  await page.keyboard.press('Meta+t')

  const toast = page.locator('.toast__message')
  await expect(toast).toContainText('no longer exists')
  await expect(toast).toContainText(folder)
  // No second tab, and nothing marked [exited]: the terminal never opened.
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1)
  await expect(page.locator('.tab-bar__tab--session')).not.toContainText('[exited]')
})
