import { test, expect, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
  projectGroup,
} from './helpers'
import { openOverview, runInVisibleTerminal } from './session-views'

// The Overview tab as a Monitor wall, against the running app: a tile shows its
// terminal's output as it arrives, and the wall's arrangement survives a restart.
// Addressed by role and name (contracts/ui-surfaces.md).

function largeTiles(page: Page) {
  return page.getByRole('radiogroup', { name: 'Tile size' }).getByRole('radio', { name: 'Large' })
}

function pinSwitch(page: Page) {
  return page.getByRole('switch', { name: 'Pin sessions that need you' })
}

async function emptyWall(page: Page): Promise<void> {
  await openOverview(page)
  await expect(page.getByText('No terminals are open')).toBeVisible()
}

async function overviewIconNamedOnFocus(page: Page): Promise<void> {
  // Focus, not hover: other apps launched at once move the real pointer. A pointer press anywhere
  // before the focus makes it a click's focus, which names nothing; a key press is what a keyboard
  // user did last, so the test says so rather than relying on nothing having been clicked.
  // Home still mounting can take focus as it settles, which hides the tooltip (CI, twice); the
  // step is about keyboard focus, so it starts once Home has drawn, and says if focus moved.
  await expect(page.getByRole('region', { name: 'Tasks' })).toBeVisible()
  await page.keyboard.press('Shift')
  const overview = page.getByRole('button', { name: 'Overview' })
  await overview.focus()
  await expect(page.locator('.tmui-tooltip')).toHaveText('Overview')
  await expect(page.locator('.tmui-tooltip')).toBeVisible()
  await expect(overview).toBeFocused()
}

/** Large before any tile exists, so the tile is placed once, at the size it keeps. */
async function arrangeWall(page: Page): Promise<void> {
  await largeTiles(page).click()
  await expect(largeTiles(page)).toHaveAttribute('aria-checked', 'true')
  await pinSwitch(page).click()
  await expect(pinSwitch(page)).toHaveAttribute('aria-checked', 'false')
}

/** Run in the page: whether the row reading `text` is drawn inside its tile's preview box. */
function rowInsidePreview(text: string): boolean {
  const row = [...document.querySelectorAll('.live-preview .xterm-rows > div')].find((r) =>
    r.textContent?.includes(text)
  )
  const preview = row?.closest('.live-preview')?.getBoundingClientRect()
  const drawn = row?.getBoundingClientRect()
  return !!drawn && !!preview && drawn.top >= preview.top && drawn.bottom <= preview.bottom
}

async function fullscreenProgramLineShows(page: Page, folder: string): Promise<void> {
  await createWorkspace(page, 'Wall', folder)
  await addAndSelectProject(page, 'Wall', 'live')
  // Like Claude Code: the alternate screen, a header at the top, the input near the bottom.
  const draw = join(folder, 'draw.sh')
  writeFileSync(
    draw,
    "printf '\\033[?1049h\\033[H HEADER-TOP'; printf '\\033[%d;1H > INPUT-LINE' $(($(tput lines)-3)); sleep 60\n"
  )
  await runInVisibleTerminal(page, `sh ${draw}`)
  await openOverview(page)
  const tile = page.getByRole('article', { name: 'Wall / live, Terminal 1' })
  await expect(tile.locator('.live-preview')).toContainText('INPUT-LINE')
  await expect.poll(() => page.evaluate(rowInsidePreview, 'INPUT-LINE')).toBe(true)
}

async function liveOutputArrives(page: Page): Promise<void> {
  // A sidebar click leaves the wall for the branch's terminals.
  await projectGroup(page, 'live').click()
  await page.getByTitle('New tab (⌘T)').click()
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(2)
  await runInVisibleTerminal(page, 'for i in $(seq 1 80); do echo tick-$i; sleep 0.1; done')
  await openOverview(page)
  const preview = page
    .getByRole('article', { name: 'Wall / live, Terminal 2' })
    .locator('.live-preview')
  await expect(preview).toContainText('tick-')
  const first = await preview.innerText()
  await expect.poll(() => preview.innerText()).not.toBe(first)
  await page.screenshot({ path: 'test-results/054/monitor-wall.png' })
}

async function arrangementRemembered(page: Page): Promise<void> {
  await openOverview(page)
  await expect(largeTiles(page)).toHaveAttribute('aria-checked', 'true')
  await expect(pinSwitch(page)).toHaveAttribute('aria-checked', 'false')
}

async function watchTheWall(page: Page, folder: string): Promise<void> {
  await test.step("keyboard focus on the rail's Overview icon names it", () =>
    overviewIconNamedOnFocus(page))
  await test.step('the wall says when no terminal is open', () => emptyWall(page))
  await test.step('the wall is set to large tiles, without pinning', () => arrangeWall(page))
  await test.step('a tile shows the line a fullscreen program is writing, not the empty middle', () =>
    fullscreenProgramLineShows(page, folder))
  await test.step("a tile shows its terminal's output as it arrives", () => liveOutputArrives(page))
}

test('the Overview wall watches every terminal, and keeps its arrangement across a restart', async () => {
  let handle: AppHandle | undefined = await launchApp()
  try {
    const profile = handle.userDataDir
    await watchTheWall(handle.page, e2eTempDir('wall-'))
    await closeApp(handle)
    handle = undefined
    handle = await launchApp(profile)
    const { page } = handle
    await test.step("the wall's size and pinning survive a restart", () =>
      arrangementRemembered(page))
  } finally {
    await closeApp(handle)
  }
})
