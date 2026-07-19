import { test, expect } from '@playwright/test'
import { AppHandle, launchApp, closeApp, createWorkspace, addAndSelectProject } from './helpers'

// Regression guard for right-edge text clipping.
//
// xterm's own CSS positions .xterm-viewport absolutely with left:0/right:0, so it spans
// the .xterm *padding box* — all the way to the element's right edge. On macOS with the
// default overlay scrollbars the scrollbar occupies zero layout width, so xterm reports
// scrollBarWidth = 0, FitAddon reserves no room for it, and the terminal is handed an
// extra column whose glyphs then render underneath the ~15px overlay scrollbar when it
// fades in. The result is the last character(s) of full-width wrapped lines being clipped.
//
// The fix gives .xterm-viewport an explicit ::-webkit-scrollbar width, which makes
// Chromium use a classic space-reserving scrollbar regardless of the OS setting. These
// tests assert the resulting invariant: rendered text must never extend into the
// scrollbar's territory, in either the single-pane or split-pane layout.

// Must match the ::-webkit-scrollbar width in TerminalPane.css.
const SCROLLBAR_WIDTH_PX = 10

let handle: AppHandle

test.beforeAll(async () => {
  handle = await launchApp()
  // Set up here rather than in the first test so no test depends on another's side
  // effects — otherwise a failure in one cascades into null-selector errors in the rest.
  const { page, userDataDir } = handle
  await createWorkspace(page, 'WS-Edge', userDataDir)
  await addAndSelectProject(page, 'WS-Edge', 'Proj-Edge')
  await expect(page.locator('.terminal-pane').first()).toBeVisible()
  await page.waitForSelector('.xterm-screen', { timeout: 15000 })
  await page.waitForTimeout(1500)
})

test.afterAll(async () => {
  await closeApp(handle)
})

interface Geometry {
  scrollbarPx: number
  screenRight: number
  viewportContentRight: number
  maxRowRight: number
}

async function measure(selector: string): Promise<Geometry> {
  return handle.page.evaluate((sel) => {
    const scope = document.querySelector(sel) as HTMLElement
    const vp = scope.querySelector('.xterm-viewport') as HTMLElement
    const sc = scope.querySelector('.xterm-screen') as HTMLElement
    const rows = scope.querySelector('.xterm-rows') as HTMLElement
    const scrollbarPx = vp.offsetWidth - vp.clientWidth
    let maxRowRight = 0
    rows.querySelectorAll('div').forEach((d) => {
      const b = (d as HTMLElement).getBoundingClientRect()
      if (b.right > maxRowRight) maxRowRight = b.right
    })
    return {
      scrollbarPx,
      screenRight: sc.getBoundingClientRect().right,
      viewportContentRight: vp.getBoundingClientRect().right - scrollbarPx,
      maxRowRight,
    }
  }, selector)
}

test('the terminal viewport reserves real layout width for its scrollbar', async () => {
  const g = await measure('.terminal-pane__container')
  // A zero-width scrollbar means we are back on OS overlay scrollbars, which is exactly
  // the condition that lets glyphs render underneath the scrollbar.
  // Exact, not just non-zero: the width is pinned by our ::-webkit-scrollbar rule. Any
  // other value means the scroller fell back to the OS scrollbar (0 with macOS overlay
  // scrollbars, ~4-15 with classic ones) and the geometry is environment-dependent again.
  expect(g.scrollbarPx).toBe(SCROLLBAR_WIDTH_PX)
})

test('single-pane: rendered text never extends under the scrollbar', async () => {
  const g = await measure('.terminal-pane__container')
  expect(g.screenRight).toBeLessThanOrEqual(g.viewportContentRight)
  expect(g.maxRowRight).toBeLessThanOrEqual(g.viewportContentRight)
})

test('split-pane: rendered text never extends under the scrollbar', async () => {
  const { page } = handle
  await page.keyboard.press('Meta+d')
  await page.waitForSelector('.leaf-pane', { timeout: 15000 })
  await page.waitForTimeout(1500)

  const g = await measure('.leaf-pane__container')
  // Exact, not just non-zero: the width is pinned by our ::-webkit-scrollbar rule. Any
  // other value means the scroller fell back to the OS scrollbar (0 with macOS overlay
  // scrollbars, ~4-15 with classic ones) and the geometry is environment-dependent again.
  expect(g.scrollbarPx).toBe(SCROLLBAR_WIDTH_PX)
  expect(g.screenRight).toBeLessThanOrEqual(g.viewportContentRight)
  expect(g.maxRowRight).toBeLessThanOrEqual(g.viewportContentRight)
})
