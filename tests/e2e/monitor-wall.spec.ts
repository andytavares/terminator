import { test, expect, type Page } from '@playwright/test'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
} from './helpers'

// The Overview tab as a Monitor wall, against the running app: a tile shows its
// terminal's output as it arrives, and the wall's arrangement survives a restart.
// Addressed by role and name (contracts/ui-surfaces.md).

// Every test launches its own app on its own profile and folder, so the
// shards can split this file by test instead of carrying all of it.
test.describe.configure({ mode: 'parallel' })

let handle: AppHandle | undefined
let folder: string

test.beforeEach(() => {
  folder = e2eTempDir('wall-')
})

test.afterEach(async () => {
  await closeApp(handle)
  handle = undefined
  rmSync(folder, { recursive: true, force: true })
})

async function openWall(page: Page): Promise<void> {
  const entry = page.getByRole('button', { name: 'Overview' })
  if ((await entry.getAttribute('aria-current')) !== 'page') await entry.click()
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

test('the wall says when no terminal is open', async () => {
  handle = await launchApp()
  await openWall(handle.page)
  await expect(handle.page.getByText('No terminals are open')).toBeVisible()
})

test("a tile shows its terminal's output as it arrives", async () => {
  handle = await launchApp()
  const { page } = handle
  await createWorkspace(page, 'Wall', folder)
  await addAndSelectProject(page, 'Wall', 'live')
  await page.locator('.terminal-pane').click()
  await page.keyboard.type('for i in $(seq 1 80); do echo tick-$i; sleep 0.1; done')
  await page.keyboard.press('Enter')

  await openWall(page)
  const tile = page.getByRole('article', { name: /Wall \/ live/ })
  await expect(tile).toBeVisible()
  const preview = tile.locator('.live-preview')
  await expect(preview).toContainText('tick-', { timeout: 10000 })
  const first = await preview.innerText()
  await expect.poll(async () => preview.innerText(), { timeout: 10000 }).not.toBe(first)

  await page.screenshot({ path: 'test-results/054/monitor-wall.png' })
})

/** Run in the page: whether the row reading `text` is drawn inside the tile's preview box. */
function rowInsidePreview(text: string): boolean {
  const preview = document.querySelector('.live-preview')!.getBoundingClientRect()
  const row = [...document.querySelectorAll('.live-preview .xterm-rows > div')].find((r) =>
    r.textContent?.includes(text)
  )
  const drawn = row?.getBoundingClientRect()
  return !!drawn && drawn.top >= preview.top && drawn.bottom <= preview.bottom
}

test('a tile shows the line a fullscreen program is writing, not the empty middle', async () => {
  handle = await launchApp()
  const { page } = handle
  // Large before the tile exists, so the tile is placed once, at the size it keeps.
  await openWall(page)
  await page
    .getByRole('radiogroup', { name: 'Tile size' })
    .getByRole('radio', { name: 'Large' })
    .click()
  await createWorkspace(page, 'Wall', folder)
  await addAndSelectProject(page, 'Wall', 'live')
  // Like Claude Code: the alternate screen, a header at the top, the input near the bottom.
  const draw = join(folder, 'draw.sh')
  writeFileSync(
    draw,
    "printf '\\033[?1049h\\033[H HEADER-TOP'; printf '\\033[%d;1H > INPUT-LINE' $(($(tput lines)-3)); sleep 60\n"
  )
  await page.locator('.terminal-pane').click()
  await page.keyboard.type(`sh ${draw}`)
  await page.keyboard.press('Enter')

  await openWall(page)
  const tile = page.getByRole('article', { name: /Wall \/ live/ })
  await expect(tile.locator('.live-preview')).toContainText('INPUT-LINE', { timeout: 10000 })
  await expect.poll(() => page.evaluate(rowInsidePreview, 'INPUT-LINE')).toBe(true)
})

test("the wall's size and pinning survive a restart", async () => {
  handle = await launchApp()
  const profile = handle.userDataDir
  await openWall(handle.page)
  await handle.page
    .getByRole('radiogroup', { name: 'Tile size' })
    .getByRole('radio', { name: 'Large' })
    .click()
  await handle.page.getByRole('switch', { name: 'Pin sessions that need you' }).click()

  await closeApp(handle)
  handle = await launchApp(profile)
  await openWall(handle.page)
  await expect(
    handle.page.getByRole('radiogroup', { name: 'Tile size' }).getByRole('radio', { name: 'Large' })
  ).toHaveAttribute('aria-checked', 'true')
  await expect(
    handle.page.getByRole('switch', { name: 'Pin sessions that need you' })
  ).toHaveAttribute('aria-checked', 'false')
})

test("keyboard focus on the rail's Overview icon names it", async () => {
  handle = await launchApp()
  // Focus, not hover: the sibling apps this file launches at once move the real pointer.
  await handle.page.getByRole('button', { name: 'Overview' }).focus()
  await expect(handle.page.locator('.tmui-tooltip')).toHaveText('Overview')
  await expect(handle.page.locator('.tmui-tooltip')).toBeVisible()
})
