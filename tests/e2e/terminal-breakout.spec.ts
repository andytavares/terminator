import { test, expect, type Locator, type Page } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  e2eTempDir,
  readTerminalRowsIn,
  visibleTerminalScreen,
} from './helpers'

// A terminal moved to its own window and back: its scrollback travels with it both ways, and the
// main window's tab strip gives up the tab while the terminal lives elsewhere.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

const sessionTabs = () => handle.page.locator('.tab-bar__tab--session')

/** A breakout window draws a terminal whose xterm instance belongs to the main window's
 * renderer, so its rows are read through the opener's reader. */
function rowsOfBreakout(page: Page): Promise<string> {
  return visibleTerminalScreen(page).evaluate((screen) =>
    window.opener.terminatorE2E.terminalRowsIn(screen).join('\n')
  )
}

async function rowsOf(page: Page): Promise<string> {
  if (page !== handle.page) return rowsOfBreakout(page)
  return (await readTerminalRowsIn(visibleTerminalScreen(page))).join('\n')
}

async function echoInto(page: Page, marker: string): Promise<void> {
  await visibleTerminalScreen(page).click()
  await page.keyboard.type(`echo ${marker}`)
  await page.keyboard.press('Enter')
  await expect.poll(() => rowsOf(page)).toContain(`\n${marker}`)
}

/** The rows hold the output whether or not xterm draws it, so this compares pixels: a terminal
 * that stopped drawing looks the same before and after the echo. */
async function echoDrawnInto(page: Page, marker: string): Promise<void> {
  const before = await visibleTerminalScreen(page).screenshot()
  await echoInto(page, marker)
  await expect
    .poll(async () => (await visibleTerminalScreen(page).screenshot()).equals(before))
    .toBe(false)
}

/** Clicks the Window menu's item in the main process; a native accelerator cannot be pressed
 * from a background-mode run. */
function clickWindowMenuItem(label: string): Promise<void> {
  return handle.app.evaluate(({ Menu }, itemLabel) => {
    const windowMenu = Menu.getApplicationMenu()?.items.find((item) => item.label === 'Window')
    const item = windowMenu?.submenu?.items.find((candidate) => candidate.label === itemLabel)
    if (!item) throw new Error(`no "${itemLabel}" item in the Window menu`)
    item.click()
  }, label)
}

async function threeTerminalsSecondSelected(workspace: string): Promise<string[]> {
  const { page } = handle
  const folder = e2eTempDir('terminator-e2e-breakout-')
  await createWorkspace(page, workspace, folder)
  await addAndSelectProject(page, workspace, 'breakout-branch')
  await expect(sessionTabs()).toHaveCount(1)
  for (const opened of [2, 3]) {
    await page.keyboard.press('ControlOrMeta+t')
    await expect(sessionTabs()).toHaveCount(opened)
  }
  // The active tab also carries its close button's "×".
  const titles = (await sessionTabs().allInnerTexts()).map((text) => text.replace('×', '').trim())
  await sessionTabs().nth(1).click()
  await expect(sessionTabs().nth(1)).toHaveClass(/tab-bar__tab--active/)
  await echoInto(page, 'breakout-marker-1')
  return titles
}

test('a terminal moves to its own window with its scrollback and docks back where it was', async () => {
  const { page, app } = handle
  const titles = await test.step('three terminals, the second holds a marker', () =>
    threeTerminalsSecondSelected('WS-Breakout'))

  const breakout = await test.step('the menu moves it to its own window', async () => {
    const opened = app.waitForEvent('window')
    await clickWindowMenuItem('Move Terminal to Its Own Window')
    return opened
  })

  await test.step('the new window names the terminal and still shows its scrollback', async () => {
    await expect(breakout.getByRole('tab')).toContainText(titles[1])
    await expect.poll(() => rowsOf(breakout)).toContain('breakout-marker-1')
  })

  await test.step('the terminal is live in the new window', () =>
    echoInto(breakout, 'breakout-marker-2'))

  await test.step('the main window keeps the other two tabs, in order', async () => {
    await expect(sessionTabs()).toHaveCount(2)
    await expect(sessionTabs().first()).toContainText(titles[0])
    await expect(sessionTabs().last()).toContainText(titles[2])
  })

  await test.step('closing the new window docks the terminal back in second place', async () => {
    await breakout.close()
    await expect(sessionTabs()).toHaveCount(3)
    await expect(sessionTabs().nth(1)).toContainText(titles[1])
    await expect(sessionTabs().nth(1)).toHaveClass(/tab-bar__tab--active/)
    await expect.poll(() => rowsOf(page)).toMatch(/breakout-marker-1[\s\S]*breakout-marker-2/)
  })
})

test('a terminal still draws after moving out, back and out again', async () => {
  await test.step('three terminals, the second holds a marker', () =>
    threeTerminalsSecondSelected('WS-Redraw'))

  for (const round of [1, 2]) {
    const breakout = await test.step(`round ${round}: the menu moves it out`, async () => {
      const opened = handle.app.waitForEvent('window')
      await clickWindowMenuItem('Move Terminal to Its Own Window')
      return opened
    })
    await test.step(`round ${round}: it draws new output in its window`, () =>
      echoDrawnInto(breakout, `redraw-out-${round}`))
    await test.step(`round ${round}: closing the window brings it back, still drawing`, async () => {
      await breakout.close()
      await expect(sessionTabs().nth(1)).toHaveClass(/tab-bar__tab--active/)
      await echoDrawnInto(handle.page, `redraw-back-${round}`)
    })
  }
})

/** Where a point on the screen falls in the page's own coordinates. */
async function pagePointOf(page: Page, screenPoint: { x: number; y: number }) {
  const origin = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }))
  return { x: screenPoint.x - origin.x, y: screenPoint.y - origin.y }
}

/** Presses on `tab`, moves well past the drag distance, and lets go at `to`, in `page`'s
 * coordinates: a captured pointer keeps reporting to the tab beyond the window's edge. */
async function dragTab(page: Page, tab: Locator, to: { x: number; y: number }): Promise<void> {
  const box = (await tab.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + 40, { steps: 4 })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()
}

test('a tab dragged out of the window opens on release, and dragged back docks', async () => {
  const { page, app } = handle
  const titles = await test.step('three terminals, the second holds a marker', () =>
    threeTerminalsSecondSelected('WS-Drag'))

  const breakout =
    await test.step('letting go of the tab left of the window opens it there', async () => {
      const opened = app.waitForEvent('window')
      await dragTab(page, sessionTabs().nth(1), { x: -300, y: 200 })
      return opened
    })

  await test.step('the window holds the terminal and its scrollback', async () => {
    await expect(breakout.getByRole('tab')).toContainText(titles[1])
    await expect.poll(() => rowsOf(breakout)).toContain('breakout-marker-1')
    await expect(sessionTabs()).toHaveCount(2)
  })

  await test.step('letting go of its tab over the main window docks it in second place', async () => {
    const mainOrigin = await page.evaluate(() => ({ x: window.screenX, y: window.screenY }))
    const target = await pagePointOf(breakout, { x: mainOrigin.x + 400, y: mainOrigin.y + 300 })
    const closed = breakout.waitForEvent('close')
    await dragTab(breakout, breakout.getByRole('tab'), target)
    await closed
    await expect(sessionTabs()).toHaveCount(3)
    await expect(sessionTabs().nth(1)).toContainText(titles[1])
  })
})

test('a tab dragged onto another tab takes its place', async () => {
  const { page } = handle
  const titles = await test.step('three terminals', () =>
    threeTerminalsSecondSelected('WS-Reorder'))
  await test.step('the third tab dropped on the first moves to the front', async () => {
    const first = (await sessionTabs().first().boundingBox())!
    await dragTab(page, sessionTabs().last(), {
      x: first.x + first.width / 2,
      y: first.y + first.height / 2,
    })
    await expect(sessionTabs().first()).toContainText(titles[2])
  })
})
