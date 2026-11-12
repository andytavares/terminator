import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { closeApp, createWorkspace, e2eTempDir, launchApp, projectGroup } from './helpers'
import type { AppHandle } from './helpers'
import { openHome } from './session-views'

// Layout that only a rendered window shows: a task drawer whose terminal printed one long,
// unbroken line (a shell prompt with a deep path) still fits its panel and never scrolls sideways.

const LONG_LINE = `/Users/someone/Desktop/${'artifactory-transfer-report-'.repeat(8)}end`

function gitFolder(): string {
  const folder = e2eTempDir('drawer-width-')
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

let handle: AppHandle

test.beforeEach(async () => {
  handle = await launchApp()
})

test.afterEach(async () => {
  await closeApp(handle)
})

test('a task drawer with a long terminal line never scrolls sideways', async () => {
  const { page } = handle
  await createWorkspace(page, 'reports', gitFolder())
  await projectGroup(page, 'main').click()
  await page.locator('.xterm').first().click()
  // Left unsent, so the line stays the terminal's latest line, as a long prompt does.
  await page.keyboard.type(`echo ${LONG_LINE}`)
  await openHome(page)
  await page.locator('.task-row__name', { hasText: 'main' }).first().click()
  const drawer = page.locator('.tmui-drawer__panel')
  await expect(drawer.getByText(LONG_LINE.slice(0, 40)).first()).toBeVisible()
  // Only a box a person can scroll counts: the live preview clips its terminal on purpose.
  const scrollingSideways = () =>
    drawer.evaluate((panel) =>
      [panel, ...panel.querySelectorAll('*')]
        .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX))
        .filter((el) => el.scrollWidth - el.clientWidth > 1)
        .map((el) => el.className)
    )
  await expect.poll(scrollingSideways).toEqual([])
})
