import { test, expect, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import {
  launchApp,
  closeApp,
  createWorkspace,
  e2eTempDir,
  profileWithoutWeeklyReview,
  projectGroup,
} from './helpers'
import type { AppHandle } from './helpers'
import { openHome } from './session-views'

// The sidebar marks one row, the session the main area shows, and a row's menu is drawn whole.
// Both were wrong in the running app while unit tests passed: a terminal stayed marked after
// another repo came on screen, and Home's containment clipped the ⋯ menu at the column edge.

/** A repository with one commit on main, so its branch row is named main. */
function gitFolder(): string {
  const folder = e2eTempDir('shown-session-')
  const git = (...args: string[]) => execFileSync('git', args, { cwd: folder, stdio: 'ignore' })
  git('init', '-q', '-b', 'main')
  git(
    '-c',
    'user.name=Demo',
    '-c',
    'user.email=demo@example.com',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'Start'
  )
  return folder
}

const marked = (page: Page) => page.locator('.unified-sidebar [aria-current="true"]')

/** Opens the newest repo's main branch: the last "main" row, as each repo adds one. */
async function openNewestMain(page: Page, repo: string): Promise<void> {
  await projectGroup(page, 'main').click()
  await expect(page.locator('.tab-bar__scope')).toContainText(repo)
}

let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp(profileWithoutWeeklyReview())
})

test.afterEach(async () => {
  await closeApp(handle)
})

test('marks only the session on screen, and nothing under Home', async () => {
  const { page } = handle
  await createWorkspace(page, 'quicknote', gitFolder())
  await openNewestMain(page, 'quicknote')
  // Its terminal row listed, as in the report: the row stayed marked once another repo showed.
  await page.getByRole('button', { name: 'Show terminals in main' }).click()
  await expect(marked(page)).toHaveCount(1)
  await expect(marked(page)).toHaveClass(/terminal-row/)
  await createWorkspace(page, 'terminator', gitFolder())
  await openNewestMain(page, 'terminator')
  await expect(marked(page)).toHaveCount(1)
  await openHome(page)
  await expect(marked(page)).toHaveCount(0)
})

test("draws a row's menu whole, on top of everything", async () => {
  const { page } = handle
  await createWorkspace(page, 'quicknote', gitFolder())
  await openNewestMain(page, 'quicknote')
  await openHome(page)
  await page.getByRole('button', { name: 'Work actions' }).first().click()
  const items = page.locator('.ctx-menu__item')
  await expect(items.first()).toBeVisible()
  const viewport =
    page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
  for (const item of await items.all()) {
    const box = (await item.boundingBox())!
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    // Clipped or covered, the point would hit whatever is drawn there instead.
    const hit = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.textContent ?? null,
      [box.x + box.width - 4, box.y + box.height / 2]
    )
    expect(hit).toBe(await item.textContent())
  }
})
