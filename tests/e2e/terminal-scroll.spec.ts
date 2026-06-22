import { test, expect } from '@playwright/test'
import {
  AppHandle,
  launchApp,
  closeApp,
  createWorkspace,
  addAndSelectProject,
  selectProject,
} from './helpers'

// Regression guard: a terminal must follow output (stay scrolled to the bottom)
// and, crucially, must NOT jump to the top when you switch away from its tab and
// come back. The persist-on-tab-switch architecture (ADR-004) moves the xterm
// element between containers, which resets the DOM viewport's scrollTop while
// xterm's internal position stays at the bottom — leaving them desynced. This
// verifies the terminal re-pins to the latest output on reattach.

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
})

test.afterAll(async () => {
  await closeApp(handle)
})

/** True when the live terminal viewport is scrolled to (or within a line of) the bottom. */
function viewportAtBottom(): Promise<boolean> {
  return handle.page.evaluate(() => {
    const vp = document.querySelector('.terminal-pane .xterm-viewport') as HTMLElement | null
    if (!vp) return false
    return vp.scrollHeight - vp.scrollTop - vp.clientHeight < 5
  })
}

test('terminal follows output and stays at the bottom across tab switches', async () => {
  const { page } = handle
  await createWorkspace(page, 'Scroll-A', handle.userDataDir)
  await addAndSelectProject(page, 'Scroll-A', 'Proj-A')
  await expect(page.locator('.tab-bar__tab--session')).toHaveCount(1)

  // Produce enough output to overflow the viewport, then confirm we're following it.
  await page.locator('.terminal-pane').click()
  await page.keyboard.type('seq 1 300')
  await page.keyboard.press('Enter')
  await expect.poll(viewportAtBottom, { timeout: 8000 }).toBe(true)

  // Switch to a different project (detaches terminal A) and back (reattaches it).
  await createWorkspace(page, 'Scroll-B', handle.userDataDir)
  await addAndSelectProject(page, 'Scroll-B', 'Proj-B')
  await selectProject(page, 'Scroll-A', 'Proj-A')

  // The reattached terminal must still be at the bottom — never scrolled to the top.
  await expect.poll(viewportAtBottom, { timeout: 8000 }).toBe(true)
})
